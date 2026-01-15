/**
 * Integration tests: MCP -> Handoff Creation
 *
 * Tests that the MCP tools correctly create and manage handoffs
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  updateRollingCheckpoint,
  createExplicitHandoff,
  getRollingCheckpoint,
  getProjectHash,
} from "../../mcp/src/storage/handoffs.js";
import {
  expectFilesTracked,
  expectTodoState,
  expectUserDecisions,
  expectPlanCached,
} from "../utils/assertions.js";

describe("MCP -> Handoff Creation", () => {
  let testProjectRoot: string;
  let testHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    const testId = `mcp-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  test("updateRollingCheckpoint creates new checkpoint", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Initial task",
      files: [{ path: "/src/index.ts", role: "created" }],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.task).toBe("Initial task");
    expectFilesTracked(checkpoint, ["/src/index.ts"]);
  });

  test("updateRollingCheckpoint merges updates", async () => {
    // First update: add files
    await updateRollingCheckpoint(testProjectRoot, "main", {
      files: [{ path: "/src/a.ts", role: "created" }],
    });

    // Second update: add todos
    await updateRollingCheckpoint(testProjectRoot, "main", {
      todos: [
        { content: "Task 1", status: "in_progress", activeForm: "Working" },
      ],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expect(checkpoint).not.toBeNull();
    expectFilesTracked(checkpoint, ["/src/a.ts"]);
    expectTodoState(checkpoint, { in_progress: 1 });
  });

  test("updateRollingCheckpoint updates existing files", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      files: [{ path: "/src/file.ts", role: "created" }],
    });

    await updateRollingCheckpoint(testProjectRoot, "main", {
      files: [{ path: "/src/file.ts", role: "modified" }],
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expect(checkpoint?.context.files).toHaveLength(1);
    expect(checkpoint?.context.files[0].role).toBe("modified");
  });

  test("updateRollingCheckpoint stores user decisions", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      userDecision: {
        question: "Use TypeScript or JavaScript?",
        answer: "TypeScript for type safety",
      },
    });

    await updateRollingCheckpoint(testProjectRoot, "main", {
      userDecision: {
        question: "Which framework?",
        answer: "React with Next.js",
      },
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expectUserDecisions(checkpoint, 2);
  });

  test("updateRollingCheckpoint caches plan content", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      plan: {
        path: "/plans/feature.md",
        content: "# Feature Plan\n\n1. Step one\n2. Step two",
      },
    });

    const checkpoint = await getRollingCheckpoint(testProjectRoot);

    expectPlanCached(checkpoint, "feature.md");
    expect(checkpoint?.context.plan?.content).toContain("Step one");
  });

  test("createExplicitHandoff generates from rolling checkpoint", async () => {
    // Build up rolling checkpoint
    await updateRollingCheckpoint(testProjectRoot, "main", {
      task: "Implementing authentication",
      files: [
        { path: "/src/auth.ts", role: "created" },
        { path: "/src/middleware.ts", role: "modified" },
      ],
    });

    await updateRollingCheckpoint(testProjectRoot, "main", {
      todos: [
        { content: "Add JWT validation", status: "in_progress", activeForm: "Adding JWT" },
        { content: "Write tests", status: "pending", activeForm: "Writing tests" },
      ],
    });

    // Create explicit handoff
    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Implementing authentication",
      summary: "Added OAuth2 flow with JWT tokens",
      nextSteps: ["Complete integration tests", "Update documentation"],
    });

    expect(handoff.id).toBeDefined();
    expect(handoff.id).toHaveLength(5); // Short ID format
    expect(handoff.context.task).toBe("Implementing authentication");
    expect(handoff.context.summary).toBe("Added OAuth2 flow with JWT tokens");
    expect(handoff.context.files).toHaveLength(2);
    expect(handoff.todos).toHaveLength(2);
    expect(handoff.context.nextSteps).toContain("Complete integration tests");
  });

  test("createExplicitHandoff includes user decisions", async () => {
    await updateRollingCheckpoint(testProjectRoot, "main", {
      userDecision: {
        question: "Use passport.js or custom auth?",
        answer: "Custom auth for more control",
      },
    });

    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "Auth implementation",
    });

    expect(handoff.context.userDecisions).toHaveLength(1);
    expect(handoff.context.userDecisions[0].question).toContain("passport.js");
  });

  test("createExplicitHandoff works without rolling checkpoint", async () => {
    // Create handoff without any prior rolling checkpoint
    const handoff = await createExplicitHandoff(testProjectRoot, {
      task: "New feature",
      summary: "Starting fresh",
    });

    expect(handoff.id).toBeDefined();
    expect(handoff.context.task).toBe("New feature");
    expect(handoff.context.files).toEqual([]);
  });

  test("getProjectHash is deterministic", () => {
    const hash1 = getProjectHash(testProjectRoot);
    const hash2 = getProjectHash(testProjectRoot);
    const hash3 = getProjectHash("/different/path");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(8);
  });
});
