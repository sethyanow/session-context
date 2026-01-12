import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  updateRollingCheckpoint,
  getRollingCheckpoint,
  getProjectHash,
  readHandoff,
  createExplicitHandoff,
} from "../storage/handoffs.js";

describe("handoffs - race condition testing", () => {
  let testProjectRoot: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testProjectRoot = join(
      tmpdir(),
      `handoffs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testProjectRoot, { recursive: true });

    // Override HOME to point to test directory
    // This makes getStorageDir() use our test directory
    const testHome = join(testProjectRoot, "home");
    await mkdir(join(testHome, ".claude", "session-context", "handoffs"), { recursive: true });
    process.env.HOME = testHome;
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up
    try {
      await rm(testProjectRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("concurrent updates should not lose data", async () => {
    // This test demonstrates the race condition:
    // 1. Two updates run concurrently
    // 2. Both read the same initial state
    // 3. Both modify different parts (files vs todos)
    // 4. The second write clobbers the first write's changes

    const branch = "main";

    // Simulate two concurrent updates - one adding files, one adding todos
    const updateFiles = updateRollingCheckpoint(testProjectRoot, branch, {
      files: [{ path: "/test/file1.ts", role: "modified" }],
    });

    const updateTodos = updateRollingCheckpoint(testProjectRoot, branch, {
      todos: [{ content: "Test todo", status: "in_progress", activeForm: "Testing" }],
    });

    // Wait for both to complete
    await Promise.all([updateFiles, updateTodos]);

    // Read the final state
    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // ASSERTION: Both updates should be present
    // This will FAIL with the current implementation due to race condition
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.files).toHaveLength(1);
    expect(checkpoint?.context.files[0].path).toBe("/test/file1.ts");
    expect(checkpoint?.todos).toHaveLength(1);
    expect(checkpoint?.todos[0].content).toBe("Test todo");
  });

  test("sequential updates should work correctly", async () => {
    // Control test: sequential updates should work fine
    const branch = "main";

    await updateRollingCheckpoint(testProjectRoot, branch, {
      files: [{ path: "/test/file1.ts", role: "modified" }],
    });

    await updateRollingCheckpoint(testProjectRoot, branch, {
      todos: [{ content: "Test todo", status: "in_progress", activeForm: "Testing" }],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.files).toHaveLength(1);
    expect(checkpoint?.todos).toHaveLength(1);
  });

  test("highly concurrent updates should preserve all data", async () => {
    // Stress test: many concurrent updates
    const branch = "main";
    const updates = [];

    // Simulate 10 concurrent file updates
    for (let i = 0; i < 10; i++) {
      updates.push(
        updateRollingCheckpoint(testProjectRoot, branch, {
          files: [{ path: `/test/file${i}.ts`, role: "modified" }],
        }),
      );
    }

    await Promise.all(updates);

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    // All 10 files should be present
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.files).toHaveLength(10);
  });

  test("file merging should update existing entries", async () => {
    const branch = "main";

    // First update: add file1 as "created"
    await updateRollingCheckpoint(testProjectRoot, branch, {
      files: [{ path: "/test/file1.ts", role: "created" }],
    });

    // Second update: modify file1 (should update role, not duplicate)
    await updateRollingCheckpoint(testProjectRoot, branch, {
      files: [{ path: "/test/file1.ts", role: "modified" }],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.files).toHaveLength(1);
    expect(checkpoint?.context.files[0].role).toBe("modified");
  });
});

describe("handoffs - explicit handoff resolution", () => {
  let testProjectRoot: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    testProjectRoot = join(
      tmpdir(),
      `handoffs-explicit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testProjectRoot, { recursive: true });

    const testHome = join(testProjectRoot, "home");
    await mkdir(join(testHome, ".claude", "session-context", "handoffs"), { recursive: true });
    process.env.HOME = testHome;
  });

  afterEach(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    try {
      await rm(testProjectRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("readHandoff with projectHash should find explicit handoff", async () => {
    // Create a rolling checkpoint first (required for createExplicitHandoff)
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Test task for explicit handoff",
      files: [{ path: "/test/file.ts", role: "modified" }],
    });

    // Create explicit handoff
    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Test explicit handoff",
    });

    expect(handoff).not.toBeNull();
    expect(handoff.id).toBeDefined();

    // Reading without projectHash should fail (old format lookup)
    const notFound = await readHandoff(handoff.id);
    expect(notFound).toBeNull();

    // Reading with projectHash should succeed
    const projectHash = getProjectHash(testProjectRoot);
    const found = await readHandoff(handoff.id, false, projectHash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(handoff.id);
    expect(found?.context.task).toBe("Test explicit handoff");
  });

  test("getProjectHash should be deterministic", () => {
    const hash1 = getProjectHash("/some/path");
    const hash2 = getProjectHash("/some/path");
    const hash3 = getProjectHash("/different/path");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(8); // First 8 chars of SHA256 hex
  });
});
