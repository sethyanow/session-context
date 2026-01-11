import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Simple file-based locking mechanism for atomic read-modify-write operations.
 *
 * This implements a cooperative lock using lock files with:
 * - Timeout-based expiration to prevent deadlocks
 * - Retry logic with exponential backoff
 * - Process ID tracking for debugging
 */

const DEFAULT_TIMEOUT_MS = 5000; // 5 seconds
const DEFAULT_RETRY_DELAY_MS = 50; // Start with 50ms
const MAX_RETRY_DELAY_MS = 500; // Cap at 500ms

export interface LockOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

export class FileLock {
  private lockPath: string;
  private locked = false;
  private pid: number;

  constructor(
    private resourcePath: string,
    private storageDir: string,
  ) {
    // Create a lock file path based on the resource being locked
    const lockName = `${resourcePath.replace(/[^a-z0-9]/gi, "_")}.lock`;
    this.lockPath = join(storageDir, lockName);
    this.pid = process.pid;
  }

  /**
   * Acquire the lock with retry logic and timeout
   */
  async acquire(options: LockOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();
    let retryDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to acquire the lock
        if (await this.tryAcquire()) {
          this.locked = true;
          return;
        }

        // Check if existing lock is stale
        if (await this.isLockStale(timeoutMs)) {
          await this.forceRelease();
          continue; // Try again immediately
        }

        // Wait before retrying (exponential backoff)
        await this.sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 1.5, MAX_RETRY_DELAY_MS);
      } catch (error) {
        // If we get an error, wait a bit and try again
        await this.sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 1.5, MAX_RETRY_DELAY_MS);
      }
    }

    throw new Error(
      `Failed to acquire lock for ${this.resourcePath} after ${timeoutMs}ms`,
    );
  }

  /**
   * Release the lock
   */
  async release(): Promise<void> {
    if (!this.locked) {
      return;
    }

    try {
      await unlink(this.lockPath);
      this.locked = false;
    } catch (error) {
      // Lock file might already be deleted, ignore
      this.locked = false;
    }
  }

  /**
   * Execute a function while holding the lock
   */
  async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {
    await this.acquire(options);
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }

  /**
   * Try to acquire the lock (non-blocking)
   */
  private async tryAcquire(): Promise<boolean> {
    try {
      const lockData = {
        pid: this.pid,
        timestamp: Date.now(),
        resource: this.resourcePath,
      };

      // Use writeFile with exclusive flag (wx) to atomically create the lock file
      // This will fail if the file already exists
      await writeFile(this.lockPath, JSON.stringify(lockData), {
        flag: "wx", // Create new file, fail if exists
      });

      return true;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error) {
        // File already exists, lock is held by someone else
        if (error.code === "EEXIST") {
          return false;
        }
      }
      // Other errors might be transient, treat as failure to acquire
      return false;
    }
  }

  /**
   * Check if the current lock is stale (held for too long)
   */
  private async isLockStale(timeoutMs: number): Promise<boolean> {
    try {
      const content = await readFile(this.lockPath, "utf-8");
      const lockData = JSON.parse(content) as { timestamp: number; pid: number };

      const age = Date.now() - lockData.timestamp;
      return age > timeoutMs * 2; // Lock is stale if held for 2x timeout
    } catch {
      // Can't read lock file, assume it's not stale
      return false;
    }
  }

  /**
   * Force release a stale lock
   */
  private async forceRelease(): Promise<void> {
    try {
      await unlink(this.lockPath);
    } catch {
      // Already deleted or inaccessible
    }
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to execute code with a lock
 */
export async function withFileLock<T>(
  resourcePath: string,
  storageDir: string,
  fn: () => Promise<T>,
  options?: LockOptions,
): Promise<T> {
  const lock = new FileLock(resourcePath, storageDir);
  return lock.withLock(fn, options);
}
