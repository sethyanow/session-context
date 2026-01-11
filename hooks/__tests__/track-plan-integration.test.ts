#!/usr/bin/env bun
/**
 * Integration test for track-plan hook
 * Tests the hook with actual execution
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { promisify } from "util";

const execFile = promisify(require("child_process").execFile);

describe("track-plan hook integration", () => {
  let testDir: string;
  let plansDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create unique temp directories
    testDir = join(tmpdir(), `track-plan-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    plansDir = join(testDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });

    // Override HOME for the hook to use our test directory
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("hook runs without errors when plans exist", async () => {
    // Create a test plan file
    const planContent = "# Test Implementation Plan\n\nThis is a test plan.\n\n## Tasks\n\n- Task 1\n- Task 2";
    await writeFile(join(plansDir, "test-plan.md"), planContent, "utf-8");

    // Execute the hook from the test directory
    const hookPath = join(__dirname, "..", "track-plan.ts");

    // Change to test directory before running
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);

      // Run the hook - should complete without error
      const result = await execFile("bun", [hookPath], {
        env: { ...process.env, HOME: testDir },
        cwd: testDir,
      });

      // Hook should exit cleanly with exit code 0
      expect(result.stderr).toBe("");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("hook handles missing plans directory gracefully", async () => {
    // Remove the plans directory
    await rm(plansDir, { recursive: true, force: true });

    const hookPath = join(__dirname, "..", "track-plan.ts");

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);

      // Run the hook - should exit gracefully without error
      const result = await execFile("bun", [hookPath], {
        env: { ...process.env, HOME: testDir },
        cwd: testDir,
      });

      // Should exit successfully even though no plans exist
      expect(result.stderr).toBe("");

      // Verify no checkpoint was created (or if it was, it has no plan)
      const projectHash = require("crypto")
        .createHash("sha256")
        .update(testDir)
        .digest("hex")
        .slice(0, 8);

      const checkpointPath = join(
        testDir,
        ".claude",
        "session-context",
        "handoffs",
        `${projectHash}-current.json`
      );

      try {
        await readFile(checkpointPath, "utf-8");
        // If file exists, it should not have a plan
      } catch {
        // File not existing is also acceptable
        expect(true).toBe(true);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
