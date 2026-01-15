/**
 * Smoke test: Handoff Flow
 *
 * Verifies the complete handoff lifecycle:
 * 1. Build up session state
 * 2. Create explicit handoff
 * 3. Simulate new session
 * 4. Recover handoff and verify state
 */
import { spawn } from "bun";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SmokeTestResult } from "../runner.js";
import {
  updateRollingCheckpoint,
  createExplicitHandoff,
  readHandoff,
  getProjectHash,
  listHandoffs,
} from "../../../mcp/src/storage/handoffs.js";

export async function runHandoffFlow(
  useRealApi: boolean
): Promise<SmokeTestResult> {
  const start = Date.now();
  const testName = "handoff-flow";

  const testDir = join(tmpdir(), `smoke-${testName}-${Date.now()}`);
  const projectDir = join(testDir, "project");
  const homeDir = join(testDir, "home");
  const originalHome = process.env.HOME;

  try {
    await mkdir(projectDir, { recursive: true });
    await mkdir(join(homeDir, ".claude", "session-context", "handoffs"), {
      recursive: true,
    });

    // Init git repo
    await spawn(["git", "init"], {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    await spawn(["git", "config", "user.email", "test@test.com"], {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    await spawn(["git", "config", "user.name", "Test"], {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;

    // Set test HOME
    process.env.HOME = homeDir;

    // === Session 1: Build state and create handoff ===

    // Simulate work being done
    await updateRollingCheckpoint(projectDir, "main", {
      task: "Implementing user authentication",
      files: [
        { path: "/src/auth/login.ts", role: "created" },
        { path: "/src/auth/logout.ts", role: "created" },
        { path: "/src/middleware/auth.ts", role: "created" },
      ],
    });

    await updateRollingCheckpoint(projectDir, "main", {
      todos: [
        { content: "Implement login endpoint", status: "completed", activeForm: "Login" },
        { content: "Implement logout endpoint", status: "completed", activeForm: "Logout" },
        { content: "Add session management", status: "in_progress", activeForm: "Sessions" },
        { content: "Write integration tests", status: "pending", activeForm: "Tests" },
      ],
    });

    await updateRollingCheckpoint(projectDir, "main", {
      userDecision: {
        question: "Use JWT or session cookies?",
        answer: "JWT for stateless auth, easier to scale",
      },
    });

    await updateRollingCheckpoint(projectDir, "main", {
      plan: {
        path: "/plans/auth.md",
        content: "# Auth Implementation\n\n1. Login/logout\n2. Sessions\n3. Tests",
      },
    });

    // Create explicit handoff
    const handoff = await createExplicitHandoff(projectDir, {
      task: "Implementing user authentication",
      summary: "Login and logout complete, working on sessions",
      nextSteps: [
        "Complete session management",
        "Add Redis for session storage",
        "Write integration tests",
      ],
      decisions: ["Using JWT for stateless auth"],
    });

    // === Session 2: Recover and verify ===

    const projectHash = getProjectHash(projectDir);

    // Try recovery by ID
    const recovered = await readHandoff(handoff.id, false, projectHash);

    if (!recovered) {
      throw new Error("Failed to recover handoff by ID");
    }

    // Verify all data is present
    const checks = {
      taskMatch: recovered.context.task === "Implementing user authentication",
      summaryMatch: recovered.context.summary.includes("sessions"),
      filesCount: recovered.context.files.length === 3,
      todosCount: recovered.todos.length === 4,
      userDecisionsCount: recovered.context.userDecisions.length >= 1,
      planPresent: !!recovered.context.plan,
      nextStepsCount: recovered.context.nextSteps.length === 3,
    };

    const allChecksPass = Object.values(checks).every((v) => v);

    if (!allChecksPass) {
      throw new Error(`Recovery validation failed: ${JSON.stringify(checks)}`);
    }

    // Verify listHandoffs works
    const handoffs = await listHandoffs(projectDir);
    if (handoffs.length !== 1) {
      throw new Error(`Expected 1 handoff in list, got ${handoffs.length}`);
    }

    return {
      name: testName,
      passed: true,
      duration: Date.now() - start,
      details: {
        handoffId: handoff.id,
        filesTracked: recovered.context.files.length,
        todosTracked: recovered.todos.length,
        userDecisions: recovered.context.userDecisions.length,
        hasPlan: !!recovered.context.plan,
        checks,
      },
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
}
