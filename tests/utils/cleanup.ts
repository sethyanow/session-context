/**
 * Cleanup utilities for test teardown
 */
import { rm, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Clean up a directory recursively
 */
export async function cleanupDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Clean up the queue directory
 */
export async function cleanupQueue(queueDir: string): Promise<void> {
  try {
    const files = await readdir(queueDir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => unlink(join(queueDir, f)))
    );
  } catch {
    // Ignore if directory doesn't exist
  }
}

/**
 * Clean up handoffs for a specific project hash
 */
export async function cleanupHandoffs(
  handoffDir: string,
  projectHash?: string
): Promise<void> {
  try {
    const files = await readdir(handoffDir);
    const toDelete = files.filter((f) => {
      if (!f.endsWith(".json")) return false;
      if (!projectHash) return true;
      return f.includes(projectHash);
    });
    await Promise.all(toDelete.map((f) => unlink(join(handoffDir, f))));
  } catch {
    // Ignore if directory doesn't exist
  }
}

/**
 * Create a cleanup function for use in afterEach
 */
export function createCleanupFn(
  paths: string[]
): () => Promise<void> {
  return async () => {
    await Promise.all(paths.map((p) => cleanupDir(p)));
  };
}
