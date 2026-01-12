#!/usr/bin/env bun
/**
 * Tests for configuration-driven tracking behavior
 * Verifies that hooks respect the SessionContextConfig toggles
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile, realpath } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir, homedir } from "os";
import { createHash } from "crypto";
import { $ } from "bun";

// Get the hooks directory relative to this test file
const HOOKS_DIR = dirname(dirname(import.meta.path));

describe("configuration-driven tracking", () => {
  let testDir: string;
  let configPath: string;
  let storageDir: string;
  let checkpointPath: string;
  let projectHash: string;
  let testConfigDir: string;

  beforeEach(async () => {
    // Create unique temp directories
    const tempDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    // Resolve symlinks (macOS /tmp -> /private/tmp) to get consistent hash
    testDir = await realpath(tempDir);

    // Set up test-specific config directory
    testConfigDir = join(testDir, ".session-context");
    await mkdir(testConfigDir, { recursive: true });
    configPath = join(testConfigDir, "config.json");

    // Set up test-local storage paths (not real home directory)
    storageDir = join(testDir, ".claude", "session-context", "handoffs");
    await mkdir(storageDir, { recursive: true });
    projectHash = createHash("sha256").update(testDir).digest("hex").slice(0, 8);
    checkpointPath = join(storageDir, `${projectHash}-current.json`);

    // Set environment variables to override paths for test isolation
    process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;
    process.env.SESSION_CONTEXT_STORAGE_DIR = storageDir;
  });

  afterEach(async () => {
    try {
      // Clean up environment variables
      delete process.env.SESSION_CONTEXT_CONFIG_PATH;
      delete process.env.SESSION_CONTEXT_STORAGE_DIR;

      await rm(testDir, { recursive: true, force: true });
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

      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-edit.ts")} Edit ${toolInput} ""`.cwd(testDir).quiet();

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

      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-edit.ts")} Edit ${toolInput} ""`.cwd(testDir).quiet();

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

      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-edit.ts")} Edit ${toolInput} ""`.cwd(testDir).quiet();

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

      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-todos.ts")} TodoWrite ${toolInput} ""`.cwd(testDir).quiet();

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

      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-todos.ts")} TodoWrite ${toolInput} ""`.cwd(testDir).quiet();

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
    // Note: These tests require write access to ~/.claude/plans/ which may be
    // blocked by sandbox. Skip with clear message if write fails.
    let plansDir: string;
    let planFile: string;
    let canWritePlans = true;

    beforeEach(async () => {
      plansDir = join(homedir(), ".claude", "plans");
      planFile = join(plansDir, `test-plan-${Date.now()}.md`);

      try {
        await mkdir(plansDir, { recursive: true });
        await writeFile(planFile, "# Test Plan\n\nSome implementation details", "utf-8");
      } catch {
        canWritePlans = false;
      }
    });

    afterEach(async () => {
      try {
        if (planFile) await rm(planFile, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("should track plans when trackPlans is enabled", async () => {
      if (!canWritePlans) {
        console.log("Skipping: Cannot write to ~/.claude/plans/ (sandbox restriction)");
        return;
      }

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

      // Run the hook
      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-plan.ts")} ExitPlanMode "" ""`.cwd(testDir).quiet();

      // Verify checkpoint was created with plan
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf-8"));
      expect(checkpoint.context.plan).toBeDefined();
      expect(checkpoint.context.plan.path).toBe(planFile);
      expect(checkpoint.context.plan.content).toContain("# Test Plan");
    });

    test("should NOT track plans when trackPlans is disabled", async () => {
      if (!canWritePlans) {
        console.log("Skipping: Cannot write to ~/.claude/plans/ (sandbox restriction)");
        return;
      }

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

      // Run the hook
      await $`SESSION_CONTEXT_CONFIG_PATH=${configPath} SESSION_CONTEXT_STORAGE_DIR=${storageDir} bun ${join(HOOKS_DIR, "track-plan.ts")} ExitPlanMode "" ""`.cwd(testDir).quiet();

      // Verify checkpoint was NOT created
      try {
        await readFile(checkpointPath, "utf-8");
        throw new Error("Checkpoint should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });
});
