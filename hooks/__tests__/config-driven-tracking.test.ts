#!/usr/bin/env bun
/**
 * Tests for configuration-driven tracking behavior
 * Verifies that hooks respect the SessionContextConfig toggles
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { createHash } from "crypto";
import { $ } from "bun";

describe("configuration-driven tracking", () => {
  let testDir: string;
  let configPath: string;
  let storageDir: string;
  let checkpointPath: string;
  let projectHash: string;
  let testConfigDir: string;

  beforeEach(async () => {
    // Create unique temp directories
    testDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Set up test-specific config directory
    testConfigDir = join(testDir, ".session-context");
    await mkdir(testConfigDir, { recursive: true });
    configPath = join(testConfigDir, "config.json");

    // Set environment variable to override config path
    process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;

    // Set up storage paths
    storageDir = join(homedir(), ".claude", "session-context", "handoffs");
    projectHash = createHash("sha256").update(testDir).digest("hex").slice(0, 8);
    checkpointPath = join(storageDir, `${projectHash}-current.json`);

    await mkdir(storageDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      // Clean up environment variable
      delete process.env.SESSION_CONTEXT_CONFIG_PATH;

      await rm(testDir, { recursive: true, force: true });
      await rm(checkpointPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("track-edit hook", () => {
    test("should track edits when trackEdits is enabled", async () => {
      // Create config with trackEdits enabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Create a test file
      const testFile = join(testDir, "test.ts");
      await writeFile(testFile, "const x = 1;", "utf-8");

      // Run the hook
      const toolInput = JSON.stringify({
        file_path: testFile,
        old_string: "const x = 1;",
        new_string: "const x = 2;",
      });

      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-edit.ts")} Edit ${toolInput} ""`.quiet();

      // Verify checkpoint was created
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf-8"));
      expect(checkpoint.context.files).toBeDefined();
      expect(checkpoint.context.files.length).toBe(1);
      expect(checkpoint.context.files[0].path).toBe(testFile);
    });

    test("should NOT track edits when trackEdits is disabled", async () => {
      // Create config with trackEdits disabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: false,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Create a test file
      const testFile = join(testDir, "test.ts");
      await writeFile(testFile, "const x = 1;", "utf-8");

      // Run the hook
      const toolInput = JSON.stringify({
        file_path: testFile,
        old_string: "const x = 1;",
        new_string: "const x = 2;",
      });

      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-edit.ts")} Edit ${toolInput} ""`.quiet();

      // Verify checkpoint was NOT created/modified
      try {
        await readFile(checkpointPath, "utf-8");
        throw new Error("Checkpoint should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    test("should NOT track edits when tracking is globally disabled", async () => {
      // Create config with tracking disabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: false,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Create a test file
      const testFile = join(testDir, "test.ts");
      await writeFile(testFile, "const x = 1;", "utf-8");

      // Run the hook
      const toolInput = JSON.stringify({
        file_path: testFile,
        old_string: "const x = 1;",
        new_string: "const x = 2;",
      });

      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-edit.ts")} Edit ${toolInput} ""`.quiet();

      // Verify checkpoint was NOT created
      try {
        await readFile(checkpointPath, "utf-8");
        throw new Error("Checkpoint should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("track-todos hook", () => {
    test("should track todos when trackTodos is enabled", async () => {
      // Create config with trackTodos enabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Run the hook
      const toolInput = JSON.stringify({
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Working on Task 1" },
          { content: "Task 2", status: "in_progress", activeForm: "Working on Task 2" },
        ],
      });

      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-todos.ts")} TodoWrite ${toolInput} ""`.quiet();

      // Verify checkpoint was created with todos
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf-8"));
      expect(checkpoint.todos).toBeDefined();
      expect(checkpoint.todos.length).toBe(2);
      expect(checkpoint.todos[0].content).toBe("Task 1");
    });

    test("should NOT track todos when trackTodos is disabled", async () => {
      // Create config with trackTodos disabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: false,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Run the hook
      const toolInput = JSON.stringify({
        todos: [{ content: "Task 1", status: "pending", activeForm: "Working on Task 1" }],
      });

      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-todos.ts")} TodoWrite ${toolInput} ""`.quiet();

      // Verify checkpoint was NOT created
      try {
        await readFile(checkpointPath, "utf-8");
        throw new Error("Checkpoint should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("track-plan hook", () => {
    test("should track plans when trackPlans is enabled", async () => {
      // Create config with trackPlans enabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Create a plan file
      const plansDir = join(homedir(), ".claude", "plans");
      await mkdir(plansDir, { recursive: true });
      const planFile = join(plansDir, "test-plan.md");
      await writeFile(planFile, "# Test Plan\n\nSome implementation details", "utf-8");

      // Run the hook
      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-plan.ts")} ExitPlanMode "" ""`.quiet();

      // Verify checkpoint was created with plan
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf-8"));
      expect(checkpoint.context.plan).toBeDefined();
      expect(checkpoint.context.plan.path).toBe(planFile);
      expect(checkpoint.context.plan.content).toContain("# Test Plan");

      // Cleanup
      await rm(plansDir, { recursive: true, force: true });
    });

    test("should NOT track plans when trackPlans is disabled", async () => {
      // Create config with trackPlans disabled
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: true,
            trackPlans: false,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Create a plan file
      const plansDir = join(homedir(), ".claude", "plans");
      await mkdir(plansDir, { recursive: true });
      const planFile = join(plansDir, "test-plan.md");
      await writeFile(planFile, "# Test Plan\n\nSome implementation details", "utf-8");

      // Run the hook
      await $`cd ${testDir} && bun ${join(process.cwd(), "hooks/track-plan.ts")} ExitPlanMode "" ""`.quiet();

      // Verify checkpoint was NOT created
      try {
        await readFile(checkpointPath, "utf-8");
        throw new Error("Checkpoint should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }

      // Cleanup
      await rm(plansDir, { recursive: true, force: true });
    });
  });
});
