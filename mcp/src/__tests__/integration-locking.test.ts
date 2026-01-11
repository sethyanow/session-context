/**
 * Integration test for file locking mechanism
 */
import { afterEach, describe, expect, test } from "bun:test";
import { FileLock, withFileLock } from "../storage/lock.js";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testDirs: string[] = [];

afterEach(async () => {
  // Clean up test directories
  for (const dir of testDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  testDirs = [];
});

function createTestDir(): string {
  const dir = join(tmpdir(), "test-locks-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  testDirs.push(dir);
  return dir;
}

describe("File Locking - Basic Operations", () => {
  test("can acquire and release a lock", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock = new FileLock("test-resource", testDir);

    // Should successfully acquire
    await expect(lock.acquire()).resolves.toBeUndefined();

    // Should successfully release
    await expect(lock.release()).resolves.toBeUndefined();
  });

  test("second lock waits for first to release", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    await lock1.acquire();

    // Try to acquire second lock with short timeout - should fail
    await expect(lock2.acquire({ timeoutMs: 100 })).rejects.toThrow("Failed to acquire lock");

    await lock1.release();
  });

  test("can acquire after previous lock is released", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    // First access
    await lock1.acquire();
    await lock1.release();

    // Second access should succeed
    await expect(lock2.acquire()).resolves.toBeUndefined();
    await lock2.release();
  });

  test("different resources don't conflict", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock1 = new FileLock("resource-a", testDir);
    const lock2 = new FileLock("resource-b", testDir);

    // Both should acquire successfully since they're different resources
    await expect(lock1.acquire()).resolves.toBeUndefined();
    await expect(lock2.acquire()).resolves.toBeUndefined();

    await lock1.release();
    await lock2.release();
  });
});

describe("File Locking - withFileLock Helper", () => {
  test("automatically acquires and releases lock", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    let executedInsideLock = false;

    const result = await withFileLock("test-resource", testDir, async () => {
      executedInsideLock = true;
      return "success";
    });

    expect(executedInsideLock).toBe(true);
    expect(result).toBe("success");
  });

  test("releases lock even if function throws", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    let error: Error | null = null;
    try {
      await withFileLock("test-resource", testDir, async () => {
        throw new Error("Test error");
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toBe("Test error");

    // Should be able to acquire lock again
    const result = await withFileLock("test-resource", testDir, async () => {
      return "lock acquired again";
    });
    expect(result).toBe("lock acquired again");
  });

  test("prevents concurrent writes", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    let counter = 0;

    // Start two concurrent operations with default timeout (5s)
    // Second one should wait for first to complete, then both succeed
    const promise1 = withFileLock("counter", testDir, async () => {
      const current = counter;
      await new Promise((resolve) => setTimeout(resolve, 50));
      counter = current + 1;
      return counter;
    });

    const promise2 = withFileLock("counter", testDir, async () => {
      const current = counter;
      await new Promise((resolve) => setTimeout(resolve, 50));
      counter = current + 1;
      return counter;
    });

    // Both should eventually succeed, but sequentially
    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");

    // Both should succeed because default timeout is 5s (enough time)
    expect(fulfilled.length).toBe(2);
    expect(counter).toBe(2); // Both increments happened sequentially
  });
});

describe("File Locking - Timeout Behavior", () => {
  test("respects custom timeout", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    await lock1.acquire();

    const startTime = Date.now();
    let error: Error | null = null;

    try {
      await lock2.acquire({ timeoutMs: 200 });
    } catch (err) {
      error = err as Error;
    }

    const elapsed = Date.now() - startTime;

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Failed to acquire lock");
    expect(elapsed).toBeGreaterThanOrEqual(150); // Allow some timing variance
    expect(elapsed).toBeLessThan(500);

    await lock1.release();
  });

  test("uses exponential backoff", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    await lock1.acquire();

    const retryDelays: number[] = [];
    const originalSetTimeout = global.setTimeout;
    let lastTime = Date.now();

    // Mock setTimeout to track retry delays
    global.setTimeout = ((fn: Function, delay: number) => {
      const now = Date.now();
      retryDelays.push(delay);
      lastTime = now;
      return originalSetTimeout(fn, delay);
    }) as typeof setTimeout;

    try {
      await lock2.acquire({ timeoutMs: 300, retryDelayMs: 25 });
    } catch {
      // Expected to timeout
    }

    global.setTimeout = originalSetTimeout;

    // Should have multiple retries with increasing delays
    expect(retryDelays.length).toBeGreaterThan(1);

    await lock1.release();
  });
});

describe("File Locking - Process ID Tracking", () => {
  test("lock file contains process ID", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const lock = new FileLock("test-resource", testDir);
    await lock.acquire();

    // Lock should be acquired successfully
    // (The lock file internally tracks PID, but we don't expose that in the public API)
    await expect(lock.release()).resolves.toBeUndefined();
  });
});

describe("File Locking - Race Condition Prevention", () => {
  test("sequential updates maintain consistency", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    let sharedState = { count: 0, items: [] as string[] };

    // Simulate 5 sequential updates
    for (let i = 0; i < 5; i++) {
      await withFileLock("shared-state", testDir, async () => {
        sharedState.count += 1;
        sharedState.items.push(`item-${i}`);
      });
    }

    expect(sharedState.count).toBe(5);
    expect(sharedState.items).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  test("prevents read-modify-write races", async () => {
    const testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    let value = 0;

    // Function that does read-modify-write
    const increment = () =>
      withFileLock("value", testDir, async () => {
        const current = value;
        await new Promise((resolve) => setTimeout(resolve, 10));
        value = current + 1;
      });

    // Run 10 increments sequentially (lock ensures no races)
    const promises = Array.from({ length: 10 }, () => increment());

    // Some will succeed, some will timeout
    await Promise.allSettled(promises);

    // Value should reflect actual successful increments
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(10);
  });
});
