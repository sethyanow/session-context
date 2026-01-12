/**
 * Tests for stale lock detection and recovery
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FileLock, withFileLock } from "../storage/lock.js";

describe("Stale Lock Detection", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `stale-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("detects and recovers from stale lock", async () => {
    const lockPath = join(testDir, "test_resource.lock");

    // Create a stale lock file manually (timestamp in the past)
    const staleTimestamp = Date.now() - 30000; // 30 seconds ago
    await writeFile(lockPath, JSON.stringify({
      pid: 99999, // Non-existent process
      timestamp: staleTimestamp,
      resource: "test-resource",
    }));

    const lock = new FileLock("test-resource", testDir);

    // Should acquire lock despite stale lock existing
    // With timeout of 500ms and stale threshold of 1000ms (2x timeout)
    await expect(lock.acquire({ timeoutMs: 500 })).resolves.toBeUndefined();

    await lock.release();
  });

  test("does not force release fresh lock", async () => {
    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    await lock1.acquire();

    // Should NOT be able to acquire with short timeout (lock is fresh, not stale)
    await expect(lock2.acquire({ timeoutMs: 200 })).rejects.toThrow("Failed to acquire lock");

    await lock1.release();
  });

  test("lock file contains correct metadata", async () => {
    const lock = new FileLock("test-resource", testDir);
    await lock.acquire();

    const lockPath = join(testDir, "test_resource.lock");
    const content = await readFile(lockPath, "utf-8");
    const lockData = JSON.parse(content);

    expect(lockData.pid).toBe(process.pid);
    expect(lockData.resource).toBe("test-resource");
    expect(typeof lockData.timestamp).toBe("number");
    expect(lockData.timestamp).toBeLessThanOrEqual(Date.now());
    expect(lockData.timestamp).toBeGreaterThan(Date.now() - 5000);

    await lock.release();
  });

  test("concurrent lock attempts with stale detection", async () => {
    // Simulate a scenario where a lock becomes stale mid-operation
    const lockPath = join(testDir, "test_resource.lock");

    // Create initially valid lock
    await writeFile(lockPath, JSON.stringify({
      pid: 99999,
      timestamp: Date.now(),
      resource: "test-resource",
    }));

    // Start lock attempt in background
    const lock = new FileLock("test-resource", testDir);

    // Overwrite with stale timestamp while lock acquisition is in progress
    setTimeout(async () => {
      await writeFile(lockPath, JSON.stringify({
        pid: 99999,
        timestamp: Date.now() - 20000, // Make it stale
        resource: "test-resource",
      }));
    }, 100);

    // Should eventually acquire after detecting stale lock
    await expect(lock.acquire({ timeoutMs: 1000 })).resolves.toBeUndefined();

    await lock.release();
  });
});

describe("Lock Contention Under Load", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lock-contention-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("multiple concurrent operations serialize correctly", async () => {
    const operations: number[] = [];
    let counter = 0;

    const doOperation = async (id: number): Promise<void> => {
      await withFileLock("counter", testDir, async () => {
        operations.push(id);
        const current = counter;
        await new Promise((resolve) => setTimeout(resolve, 20));
        counter = current + 1;
      });
    };

    // Start 5 operations concurrently
    const promises = [
      doOperation(1),
      doOperation(2),
      doOperation(3),
      doOperation(4),
      doOperation(5),
    ];

    await Promise.all(promises);

    // All should have completed
    expect(operations.length).toBe(5);
    expect(counter).toBe(5);

    // Operations should have unique order (serialized)
    expect(new Set(operations).size).toBe(5);
  });

  test("lock with custom retry delay", async () => {
    const lock1 = new FileLock("test-resource", testDir);
    const lock2 = new FileLock("test-resource", testDir);

    await lock1.acquire();

    const startTime = Date.now();

    // Try to acquire with very small retry delay - should fail faster
    await expect(lock2.acquire({
      timeoutMs: 100,
      retryDelayMs: 10,
    })).rejects.toThrow("Failed to acquire lock");

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(80); // Should have attempted for ~100ms

    await lock1.release();
  });

  test("rapid lock acquire-release cycles", async () => {
    const iterations = 20;
    let value = 0;

    for (let i = 0; i < iterations; i++) {
      await withFileLock("rapid-test", testDir, async () => {
        value++;
      });
    }

    expect(value).toBe(iterations);
  });

  test("lock release is idempotent", async () => {
    const lock = new FileLock("test-resource", testDir);

    await lock.acquire();

    // Release multiple times should not throw
    await expect(lock.release()).resolves.toBeUndefined();
    await expect(lock.release()).resolves.toBeUndefined();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  test("re-acquiring after release", async () => {
    const lock = new FileLock("test-resource", testDir);

    // Acquire, release, acquire again should work
    await lock.acquire();
    await lock.release();
    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
  });
});

describe("Lock Error Handling", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lock-error-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("withFileLock propagates function errors", async () => {
    const testError = new Error("Test operation failed");

    await expect(withFileLock("test-resource", testDir, async () => {
      throw testError;
    })).rejects.toThrow("Test operation failed");

    // Lock should be released after error
    const lock = new FileLock("test-resource", testDir);
    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
  });

  test("withFileLock returns function result", async () => {
    const result = await withFileLock("test-resource", testDir, async () => {
      return { data: "test", count: 42 };
    });

    expect(result).toEqual({ data: "test", count: 42 });
  });

  test("handles corrupted lock file", async () => {
    const lockPath = join(testDir, "test_resource.lock");
    await writeFile(lockPath, "not valid json");

    const lock = new FileLock("test-resource", testDir);

    // Should timeout since it can't parse the corrupted lock
    await expect(lock.acquire({ timeoutMs: 200 })).rejects.toThrow("Failed to acquire lock");
  });
});
