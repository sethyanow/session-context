/**
 * Integration tests: Concurrent Checkpoint Updates
 *
 * Tests that parallel updateRollingCheckpoint calls preserve all data
 * correctly using the file locking mechanism.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  updateRollingCheckpoint,
  getRollingCheckpoint,
  getProjectHash,
} from "../../mcp/src/storage/handoffs.js";

describe("Concurrent Checkpoint Updates", () => {
  let testProjectRoot: string;
  let testHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    const testId = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testProjectRoot = join(tmpdir(), testId, "project");
    testHome = join(tmpdir(), testId, "home");

    await mkdir(testProjectRoot, { recursive: true });
    await mkdir(join(testHome, ".claude", "session-context", "handoffs"), {
      recursive: true,
    });

    // Init git repo
    const { spawn } = await import("bun");
    await spawn(["git", "init"], {
      cwd: testProjectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;

    process.env.HOME = testHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;

    try {
      const baseDir = testProjectRoot.split("/").slice(0, -1).join("/");
      await rm(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("parallel file updates from multiple workers preserve all files", async () => {
    const numWorkers = 5;

    // Create initial checkpoint
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Parallel test",
    });

    // Run parallel file updates
    const promises = Array.from({ length: numWorkers }, (_, i) =>
      updateRollingCheckpoint(testProjectRoot, "main", {
        files: [{ path: `/src/file${i}.ts`, role: "modified" }],
      }),
    );

    await Promise.all(promises);

    const checkpoint = await getRollingCheckpoint(testProjectRoot);
    expect(checkpoint).not.toBeNull();

    // All 5 files should be present (files merge, don't replace)
    expect(checkpoint?.context.files).toHaveLength(numWorkers);

    const paths = checkpoint?.context.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "/src/file0.ts",
      "/src/file1.ts",
      "/src/file2.ts",
      "/src/file3.ts",
      "/src/file4.ts",
    ]);
  });

  test("mixed update types (files, todos, userDecisions) all persist", async () => {
    // Create initial checkpoint
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Mixed update test",
    });

    // Run different update types in parallel
    await Promise.all([
      updateRollingCheckpoint(testProjectRoot, "main", {
        files: [{ path: "/src/a.ts", role: "created" }],
      }),
      updateRollingCheckpoint(testProjectRoot, "main", {
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Task 1" },
        ],
      }),
      updateRollingCheckpoint(testProjectRoot, "main", {
        userDecision: { question: "Approach?", answer: "Use method B" },
      }),
    ]);

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // All update types should be present
    expect(checkpoint?.context.files.length).toBeGreaterThanOrEqual(1);
    expect(checkpoint?.todos.length).toBeGreaterThanOrEqual(1);
    expect(checkpoint?.context.userDecisions.length).toBeGreaterThanOrEqual(1);
  });

  test("high contention does not cause data loss for successful updates", async () => {
    const iterations = 20;

    // Create initial checkpoint
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Stress test",
    });

    // Run many parallel updates
    const promises = Array.from({ length: iterations }, (_, i) =>
      updateRollingCheckpoint(testProjectRoot, "main", {
        files: [{ path: `/stress/file${i}.ts`, role: "modified" }],
      }),
    );

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    // Under high contention, some updates may timeout waiting for lock.
    // This is expected behavior - verify most succeed and no data loss.
    expect(succeeded).toBeGreaterThanOrEqual(10); // At least half should succeed

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // Files from successful updates should all be present (no data loss)
    expect(checkpoint?.context.files.length).toBe(succeeded);
  }, 30000); // Extended timeout for stress test

  test("parallel todo updates replace entire array (not merge)", async () => {
    // Create initial checkpoint with todos
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Todo replacement test",
      todos: [
        { content: "Original", status: "pending", activeForm: "Original" },
      ],
    });

    // Send two todo updates - last one wins
    await updateRollingCheckpoint(testProjectRoot, "main", {
      todos: [{ content: "First", status: "pending", activeForm: "First" }],
    });

    await updateRollingCheckpoint(testProjectRoot, "main", {
      todos: [{ content: "Second", status: "pending", activeForm: "Second" }],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // Only the last todo array should be present (todos replace, don't merge)
    expect(checkpoint?.todos).toHaveLength(1);
    expect(checkpoint?.todos[0].content).toBe("Second");
  });

  test("parallel updates preserve task and other context fields", async () => {
    // Create initial checkpoint with task
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Important task",
      files: [{ path: "/initial.ts", role: "created" }],
    });

    // Run parallel updates that don't include task
    await Promise.all([
      updateRollingCheckpoint(testProjectRoot, "main", {
        files: [{ path: "/a.ts", role: "modified" }],
      }),
      updateRollingCheckpoint(testProjectRoot, "main", {
        files: [{ path: "/b.ts", role: "modified" }],
      }),
    ]);

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // Task should be preserved
    expect(checkpoint?.context.task).toBe("Important task");

    // All files should be present
    expect(checkpoint?.context.files).toHaveLength(3);
  });
});
