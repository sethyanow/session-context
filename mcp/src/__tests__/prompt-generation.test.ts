import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExplicitHandoff,
  updateRollingCheckpoint,
} from "../storage/handoffs.js";

describe("prompt generation", () => {
  let testProjectRoot: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testProjectRoot = join(
      tmpdir(),
      `prompt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testProjectRoot, { recursive: true });

    // Override HOME to point to test directory
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

  describe("extractPlanSummary behavior via handoff creation", () => {
    test("handoff includes plan content when available", async () => {
      const planContent = `# Plan: Add User Authentication

## Summary
Implement OAuth2 flow with JWT tokens.

## Steps
1. Add passport.js dependency
2. Configure OAuth providers
3. Create auth middleware
4. Add protected routes
`;

      // Create rolling checkpoint with plan
      await updateRollingCheckpoint(testProjectRoot, "main", {
        task: "Implementing auth",
        plan: { path: "/test/plan.md", content: planContent },
      });

      // Create explicit handoff
      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.plan).toBeDefined();
      expect(handoff.context.plan?.content).toContain("Add User Authentication");
      expect(handoff.context.plan?.content).toContain("passport.js");
    });

    test("handoff preserves todos", async () => {
      await updateRollingCheckpoint(testProjectRoot, "main", {
        todos: [
          { content: "First task", status: "completed", activeForm: "Completing first task" },
          { content: "Current task", status: "in_progress", activeForm: "Working on current" },
          { content: "Pending task", status: "pending", activeForm: "Starting pending" },
        ],
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.todos).toHaveLength(3);
      expect(handoff.todos.find((t) => t.status === "in_progress")?.content).toBe("Current task");
    });

    test("handoff preserves files with roles", async () => {
      await updateRollingCheckpoint(testProjectRoot, "main", {
        files: [
          { path: "/src/auth.ts", role: "created" },
          { path: "/src/index.ts", role: "modified" },
          { path: "/docs/README.md", role: "read" },
        ],
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.files).toHaveLength(3);
      expect(handoff.context.files.find((f) => f.path === "/src/auth.ts")?.role).toBe("created");
    });

    test("handoff preserves user decisions", async () => {
      await updateRollingCheckpoint(testProjectRoot, "main", {
        userDecision: { question: "Use OAuth or JWT?", answer: "Both - OAuth with JWT tokens" },
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.userDecisions).toHaveLength(1);
      expect(handoff.context.userDecisions[0].question).toBe("Use OAuth or JWT?");
      expect(handoff.context.userDecisions[0].answer).toBe("Both - OAuth with JWT tokens");
    });
  });

  describe("handoff context merging", () => {
    test("explicit handoff overrides merge with rolling checkpoint", async () => {
      // Set up rolling checkpoint
      await updateRollingCheckpoint(testProjectRoot, "main", {
        task: "Original task",
        files: [{ path: "/src/file.ts", role: "modified" }],
      });

      // Create explicit handoff with overrides
      const handoff = await createExplicitHandoff(testProjectRoot, {
        task: "New explicit task",
        summary: "This is the handoff summary",
        nextSteps: ["First step", "Second step"],
      });

      // Overrides should take effect
      expect(handoff.context.task).toBe("New explicit task");
      expect(handoff.context.summary).toBe("This is the handoff summary");
      expect(handoff.context.nextSteps).toEqual(["First step", "Second step"]);
      // But files should still be preserved from rolling
      expect(handoff.context.files).toHaveLength(1);
    });
  });

  describe("task handling", () => {
    test("task defaults to 'Working on project' when not set", async () => {
      await updateRollingCheckpoint(testProjectRoot, "main", {
        todos: [
          { content: "Implement user login", status: "in_progress", activeForm: "Implementing login" },
        ],
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      // Task stays at default - inference happens in queue processor or prompt generation
      expect(handoff.context.task).toBe("Working on project");
      // But todos are preserved for prompt generation to use
      expect(handoff.todos).toHaveLength(1);
    });

    test("explicit task is preserved", async () => {
      await updateRollingCheckpoint(testProjectRoot, "main", {
        task: "My explicit task",
        todos: [
          { content: "Different todo", status: "in_progress", activeForm: "Working" },
        ],
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.task).toBe("My explicit task");
    });
  });

  describe("plan summary extraction", () => {
    test("plan with numbered steps extracts points", async () => {
      const planContent = `# Plan: Database Migration

## Overview
Migrate from SQLite to PostgreSQL.

## Steps
1. Install pg driver
2. Update connection config
3. Run migrations
4. Verify data integrity
5. Update deployment scripts
`;

      await updateRollingCheckpoint(testProjectRoot, "main", {
        plan: { path: "/test/plan.md", content: planContent },
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.plan?.content).toContain("Install pg driver");
      expect(handoff.context.plan?.content).toContain("Update connection config");
    });

    test("plan with bullet points extracts points", async () => {
      const planContent = `# Plan: Code Review

## Tasks
- Review authentication module
- Check error handling
- Verify test coverage
`;

      await updateRollingCheckpoint(testProjectRoot, "main", {
        plan: { path: "/test/plan.md", content: planContent },
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {});

      expect(handoff.context.plan?.content).toContain("Review authentication module");
    });
  });
});
