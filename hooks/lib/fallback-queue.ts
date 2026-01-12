/**
 * Fallback queue for hooks when direct checkpoint writes fail (sandbox restrictions)
 *
 * Pattern:
 * 1. Hook tries direct write to ~/.claude/session-context/handoffs/
 * 2. On EPERM, queues to /tmp/claude/session-context-queue/ (sandbox allows /tmp/claude/)
 * 3. MCP server processes queue on startup and periodically
 * 4. Hook outputs structured message so Claude knows fallback was used
 */

import { mkdir, writeFile, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// /tmp/claude/ is in sandbox allowlist
const QUEUE_DIR = "/tmp/claude/session-context-queue";

export interface QueuedUpdate {
  id: string;
  timestamp: string;
  projectRoot: string;
  updateType: "file" | "todo" | "plan" | "userDecision";
  payload: unknown;
}

/**
 * Ensure queue directory exists
 */
export async function ensureQueueDir(): Promise<void> {
  await mkdir(QUEUE_DIR, { recursive: true });
}

/**
 * Queue an update for later processing by MCP
 */
export async function queueUpdate(update: Omit<QueuedUpdate, "id" | "timestamp">): Promise<string> {
  await ensureQueueDir();

  const id = randomUUID().slice(0, 8);
  const queuedUpdate: QueuedUpdate = {
    id,
    timestamp: new Date().toISOString(),
    ...update,
  };

  const filename = `${Date.now()}-${id}.json`;
  const filepath = join(QUEUE_DIR, filename);

  await writeFile(filepath, JSON.stringify(queuedUpdate, null, 2), "utf-8");

  return id;
}

/**
 * Read all queued updates (for MCP to process)
 */
export async function readQueue(): Promise<{ updates: QueuedUpdate[]; files: string[] }> {
  try {
    await ensureQueueDir();
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
export async function removeFromQueue(filename: string): Promise<void> {
  try {
    await unlink(join(QUEUE_DIR, filename));
  } catch {
    // Ignore if already removed
  }
}

/**
 * Clear entire queue (after successful processing)
 */
export async function clearQueue(): Promise<number> {
  const { files } = await readQueue();
  for (const file of files) {
    await removeFromQueue(file);
  }
  return files.length;
}

/**
 * Check if an error is a permission error (sandbox block)
 */
export function isPermissionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("eperm") ||
      msg.includes("eacces") ||
      msg.includes("operation not permitted") ||
      msg.includes("permission denied")
    );
  }
  return false;
}

/**
 * Output a structured hook response indicating fallback was used
 * This helps Claude understand what happened
 */
export function outputFallbackUsed(updateType: string, queueId: string): void {
  const response = {
    continue: true,
    hookSpecificOutput: {
      fallbackUsed: true,
      reason: "Direct write failed (sandbox), queued for MCP processing",
      updateType,
      queueId,
      queueDir: QUEUE_DIR,
    },
  };
  console.log(JSON.stringify(response));
}
