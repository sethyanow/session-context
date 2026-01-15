/**
 * Wait utilities for async testing
 */
import { stat, readdir } from "node:fs/promises";

/**
 * Wait for a condition to become true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(interval);
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Wait for a file to exist
 */
export async function waitForFile(
  path: string,
  options: { timeout?: number } = {}
): Promise<void> {
  await waitFor(
    async () => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    { timeout: options.timeout }
  );
}

/**
 * Wait for queue to be processed (empty)
 */
export async function waitForQueueEmpty(
  queueDir: string,
  options: { timeout?: number } = {}
): Promise<void> {
  await waitFor(
    async () => {
      try {
        const files = await readdir(queueDir);
        return files.filter((f) => f.endsWith(".json")).length === 0;
      } catch {
        return true; // Dir doesn't exist = empty
      }
    },
    { timeout: options.timeout }
  );
}

/**
 * Wait for queue to have at least N items
 */
export async function waitForQueueItems(
  queueDir: string,
  minCount: number,
  options: { timeout?: number } = {}
): Promise<void> {
  await waitFor(
    async () => {
      try {
        const files = await readdir(queueDir);
        return files.filter((f) => f.endsWith(".json")).length >= minCount;
      } catch {
        return false;
      }
    },
    { timeout: options.timeout }
  );
}

/**
 * Poll until a function returns a non-null value
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  options: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result !== null && result !== undefined) {
      return result;
    }
    await Bun.sleep(interval);
  }

  throw new Error(`pollUntil timed out after ${timeout}ms`);
}
