/**
 * Integration tests: Handoff -> Session Recovery
 *
 * Tests that handoffs can be recovered correctly in new sessions
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  updateRollingCheckpoint,
  createExplicitHandoff,
  readHandoff,
  getProjectHash,
  getRollingCheckpoint,
  listHandoffs,
} from "../../mcp/src/storage/handoffs.js";

describe("Handoff -> Session Recovery", () => {
  let testProjectRoot: string;
  let testHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    const testId = `handoff-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  test("explicit handoff can be recovered by ID with projectHash", async () => {
    // Create a handoff
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Feature implementation",
      files: [{ path: "/src/feature.ts", role: "created" }],
    });

    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Feature implementation",
      summary: "Initial implementation complete",
    });

    // Recover it using ID + projectHash
    const projectHash = getProjectHash(testProjectRoot);
    const recovered = await readHandoff(handoff.id, false, projectHash);

    expect(recovered).not.toBeNull();
    expect(recovered?.id).toBe(handoff.id);
    expect(recovered?.context.task).toBe("Feature implementation");
    expect(recovered?.context.files).toHaveLength(1);
  });

  test("readHandoff without projectHash returns null for new format", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Test task",
    });

    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Test task",
    });

    // Reading without projectHash should fail (old format lookup)
    const notFound = await readHandoff(handoff.id);
    expect(notFound).toBeNull();

    // Reading with projectHash should succeed
    const projectHash = getProjectHash(testProjectRoot);
    const found = await readHandoff(handoff.id, false, projectHash);
    expect(found).not.toBeNull();
  });

  test("rolling checkpoint auto-recovery works", async () => {
    // Create rolling checkpoint
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Work in progress",
      todos: [
        { content: "Current task", status: "in_progress", activeForm: "Working" },
      ],
    });

    // Simulate session restart - get rolling checkpoint
    const rolling = await getRollingCheckpoint(testProjectRoot);

    expect(rolling).not.toBeNull();
    expect(rolling?.context.task).toBe("Work in progress");
    expect(rolling?.todos).toHaveLength(1);
  });

  test("recovery restores complete context", async () => {
    // Build comprehensive checkpoint
    await updateRollingCheckpoint(testProjectRoot, "develop", {
      task: "Complex feature",
      files: [
        { path: "/src/a.ts", role: "created" },
        { path: "/src/b.ts", role: "modified" },
      ],
    });

    await updateRollingCheckpoint(testProjectRoot, "develop", {
      todos: [
        { content: "Step 1", status: "completed", activeForm: "Done 1" },
        { content: "Step 2", status: "in_progress", activeForm: "Doing 2" },
        { content: "Step 3", status: "pending", activeForm: "Will do 3" },
      ],
    });

    await updateRollingCheckpoint(testProjectRoot, "develop", {
      plan: {
        path: "/plans/feature.md",
        content: "# Feature Plan\n\n1. Step one\n2. Step two",
      },
    });

    await updateRollingCheckpoint(testProjectRoot, "develop", {
      userDecision: {
        question: "Which approach?",
        answer: "Use approach B",
      },
    });

    // Create and recover handoff
    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Complex feature",
    });

    const projectHash = getProjectHash(testProjectRoot);
    const recovered = await readHandoff(handoff.id, false, projectHash);

    expect(recovered?.context.files).toHaveLength(2);
    expect(recovered?.todos).toHaveLength(3);
    expect(recovered?.context.plan).toBeDefined();
    expect(recovered?.context.plan?.content).toContain("Step one");
    expect(recovered?.context.userDecisions).toHaveLength(1);
    expect(recovered?.project.branch).toBe("develop");
  });

  test("listHandoffs returns all handoffs for project", async () => {
    // Create multiple handoffs with explicit delay to ensure different timestamps
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Task 1",
    });
    await createExplicitHandoff(testProjectRoot, { task: "Task 1" });

    // Small delay to ensure different timestamps
    await Bun.sleep(10);

    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Task 2",
    });
    await createExplicitHandoff(testProjectRoot, { task: "Task 2" });

    const handoffs = await listHandoffs(testProjectRoot);

    expect(handoffs.length).toBe(2);
    // Should be sorted by updated time (most recent first)
    // Both tasks should be present
    const tasks = handoffs.map((h) => h.context.task);
    expect(tasks).toContain("Task 1");
    expect(tasks).toContain("Task 2");
  });

  test("handoff preserves project metadata", async () => {
    await updateRollingCheckpoint(testProjectRoot, "feature-branch", {
      task: "Feature work",
    });

    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Feature work",
    });

    expect(handoff.project.root).toBe(testProjectRoot);
    expect(handoff.project.branch).toBe("feature-branch");
    expect(handoff.project.hash).toBe(getProjectHash(testProjectRoot));
  });

  test("handoff has correct TTL values", async () => {
    // Rolling checkpoint has 24h TTL
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Test",
    });

    const rolling = await getRollingCheckpoint(testProjectRoot);
    expect(rolling?.ttl).toBe("24h");

    // Explicit handoff has 7d TTL
    const explicit = await createExplicitHandoff(testProjectRoot, {
      task: "Test",
    });
    expect(explicit.ttl).toBe("7d");
  });
});
