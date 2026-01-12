/**
 * Queue processor for handling fallback updates from hooks
 *
 * When hooks can't write directly (sandbox restrictions), they queue
 * updates to /tmp/claude/session-context-queue/. This processor
 * applies those updates to the actual checkpoint using updateRollingCheckpoint
 * for proper file locking and consistency.
 */

import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { updateRollingCheckpoint } from "../storage/handoffs.js";
import type { Handoff, TodoItem, PlanCache, UserDecision } from "../types.js";
import { getBranch } from "../integrations/git.js";

const QUEUE_DIR = "/tmp/claude/session-context-queue";

interface QueuedUpdate {
  id: string;
  timestamp: string;
  projectRoot: string;
  updateType: "file" | "todo" | "plan" | "userDecision";
  payload: unknown;
}

interface FilePayload {
  filePath: string;
  role: string;
}

interface TodoPayload {
  todos: TodoItem[];
}

interface PlanPayload {
  plan: PlanCache;
  taskFromPlan?: string;
}

interface UserDecisionPayload {
  decisions: UserDecision[];
}

/**
 * Read all queued updates
 */
async function readQueue(): Promise<{ updates: QueuedUpdate[]; files: string[] }> {
  try {
    await mkdir(QUEUE_DIR, { recursive: true });
    const files = await readdir(QUEUE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const updates: QueuedUpdate[] = [];
    const validFiles: string[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(QUEUE_DIR, file), "utf-8");
        updates.push(JSON.parse(content));
        validFiles.push(file);
      } catch {
        // Skip invalid files
      }
    }

    // Sort by timestamp
    updates.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return { updates, files: validFiles };
  } catch {
    return { updates: [], files: [] };
  }
}

/**
 * Remove a processed queue file
 */
async function removeFromQueue(filename: string): Promise<void> {
  try {
    await unlink(join(QUEUE_DIR, filename));
  } catch {
    // Ignore if already removed
  }
}

/**
 * Convert queued update to updateRollingCheckpoint params
 */
function convertUpdate(update: QueuedUpdate): Partial<{
  task: string;
  files: Handoff["context"]["files"];
  todos: Handoff["todos"];
  plan: { path: string; content: string };
  userDecision: { question: string; answer: string };
}> {
  switch (update.updateType) {
    case "file": {
      const payload = update.payload as FilePayload;
      return {
        files: [{ path: payload.filePath, role: payload.role }],
      };
    }

    case "todo": {
      const payload = update.payload as TodoPayload;
      const updates: ReturnType<typeof convertUpdate> = {
        todos: payload.todos,
      };
      // Infer task from in-progress todo
      const inProgressTodo = payload.todos.find((t) => t.status === "in_progress");
      if (inProgressTodo) {
        updates.task = inProgressTodo.content;
      }
      return updates;
    }

    case "plan": {
      const payload = update.payload as PlanPayload;
      const updates: ReturnType<typeof convertUpdate> = {
        plan: { path: payload.plan.path, content: payload.plan.content },
      };
      if (payload.taskFromPlan) {
        updates.task = payload.taskFromPlan;
      }
      return updates;
    }

    case "userDecision": {
      const payload = update.payload as UserDecisionPayload;
      // Process first decision (updateRollingCheckpoint handles one at a time)
      if (payload.decisions.length > 0) {
        const first = payload.decisions[0];
        return {
          userDecision: { question: first.question, answer: first.answer },
        };
      }
      return {};
    }

    default:
      return {};
  }
}

/**
 * Process all queued updates using updateRollingCheckpoint for proper locking
 * Returns count of processed updates
 */
export async function processQueue(): Promise<{
  processed: number;
  errors: number;
  byProject: Record<string, number>;
}> {
  const { updates, files } = await readQueue();

  if (updates.length === 0) {
    return { processed: 0, errors: 0, byProject: {} };
  }

  // Group updates by project
  const byProject = new Map<string, { updates: QueuedUpdate[]; files: string[] }>();

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    const file = files[i];

    if (!byProject.has(update.projectRoot)) {
      byProject.set(update.projectRoot, { updates: [], files: [] });
    }
    byProject.get(update.projectRoot)!.updates.push(update);
    byProject.get(update.projectRoot)!.files.push(file);
  }

  let processed = 0;
  let errors = 0;
  const projectCounts: Record<string, number> = {};

  // Process each project's updates
  for (const [projectRoot, data] of byProject) {
    try {
      const branch = (await getBranch(projectRoot)) ?? "main";

      // Process each update using updateRollingCheckpoint (with file locking)
      for (let i = 0; i < data.updates.length; i++) {
        const update = data.updates[i];
        const file = data.files[i];

        try {
          const params = convertUpdate(update);
          if (Object.keys(params).length > 0) {
            await updateRollingCheckpoint(projectRoot, branch, params);
          }
          await removeFromQueue(file);
          processed++;
        } catch {
          errors++;
        }
      }

      projectCounts[projectRoot] = data.updates.length;
    } catch (err) {
      // If we can't process, leave queue files for retry
      errors += data.updates.length;
      console.error(`Failed to process queue for ${projectRoot}:`, err);
    }
  }

  return { processed, errors, byProject: projectCounts };
}

/**
 * Check if there are pending updates in the queue
 */
export async function hasQueuedUpdates(): Promise<boolean> {
  const { updates } = await readQueue();
  return updates.length > 0;
}

/**
 * Get queue status without processing
 */
export async function getQueueStatus(): Promise<{
  pending: number;
  oldestTimestamp: string | null;
  byType: Record<string, number>;
}> {
  const { updates } = await readQueue();

  const byType: Record<string, number> = {};
  for (const update of updates) {
    byType[update.updateType] = (byType[update.updateType] || 0) + 1;
  }

  return {
    pending: updates.length,
    oldestTimestamp: updates.length > 0 ? updates[0].timestamp : null,
    byType,
  };
}
