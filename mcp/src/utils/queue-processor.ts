/**
 * Queue processor for handling fallback updates from hooks
 *
 * When hooks can't write directly (sandbox restrictions), they queue
 * updates to /tmp/claude/session-context-queue/. This processor
 * applies those updates to the actual checkpoint.
 */

import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
  type Checkpoint,
  type CheckpointFile,
  type CheckpointUserDecision,
  type CheckpointPlan,
} from "./checkpoint.js";
import { writeFile } from "node:fs/promises";

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
  todos: Checkpoint["todos"];
}

interface PlanPayload {
  plan: CheckpointPlan;
  taskFromPlan?: string;
}

interface UserDecisionPayload {
  decisions: CheckpointUserDecision[];
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
 * Apply a single update to the checkpoint
 */
async function applyUpdate(checkpoint: Checkpoint, update: QueuedUpdate): Promise<void> {
  switch (update.updateType) {
    case "file": {
      const payload = update.payload as FilePayload;
      if (!Array.isArray(checkpoint.context.files)) {
        checkpoint.context.files = [];
      }
      const existingIndex = checkpoint.context.files.findIndex(
        (f: CheckpointFile) => f.path === payload.filePath
      );
      if (existingIndex >= 0) {
        checkpoint.context.files[existingIndex].role = payload.role;
      } else {
        checkpoint.context.files.push({ path: payload.filePath, role: payload.role });
      }
      break;
    }

    case "todo": {
      const payload = update.payload as TodoPayload;
      checkpoint.todos = payload.todos;

      // Infer task from in-progress todo
      const inProgressTodo = payload.todos.find((t) => t.status === "in_progress");
      if (
        inProgressTodo &&
        (!checkpoint.context.task || checkpoint.context.task === "Working on project")
      ) {
        checkpoint.context.task = inProgressTodo.content;
      }
      break;
    }

    case "plan": {
      const payload = update.payload as PlanPayload;
      checkpoint.context.plan = payload.plan;

      if (
        payload.taskFromPlan &&
        (!checkpoint.context.task || checkpoint.context.task === "Working on project")
      ) {
        checkpoint.context.task = payload.taskFromPlan;
      }
      break;
    }

    case "userDecision": {
      const payload = update.payload as UserDecisionPayload;
      if (!Array.isArray(checkpoint.context.userDecisions)) {
        checkpoint.context.userDecisions = [];
      }

      checkpoint.context.userDecisions.push(...payload.decisions);

      // Keep only last 20 decisions
      if (checkpoint.context.userDecisions.length > 20) {
        checkpoint.context.userDecisions = checkpoint.context.userDecisions.slice(-20);
      }
      break;
    }
  }
}

/**
 * Process all queued updates
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
      const checkpoint = await getOrCreateCheckpoint(projectRoot);

      for (const update of data.updates) {
        try {
          await applyUpdate(checkpoint, update);
          processed++;
        } catch {
          errors++;
        }
      }

      // Save checkpoint once after all updates
      checkpoint.updated = new Date().toISOString();
      const checkpointPath = getCheckpointPath(projectRoot);
      await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

      // Remove processed files
      for (const file of data.files) {
        await removeFromQueue(file);
      }

      projectCounts[projectRoot] = data.updates.length;
    } catch (err) {
      // If we can't write to checkpoint, leave queue files for retry
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
