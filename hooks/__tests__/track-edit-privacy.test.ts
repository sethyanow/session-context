#!/usr/bin/env bun
/**
 * Tests for privacy exclusions in track-edit hook
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execFile = promisify(require("child_process").execFile);

describe("track-edit hook privacy exclusions", () => {
  let testDir: string;
  let storageDir: string;
  let originalHome: string | undefined;
  let hookPath: string;

  beforeEach(async () => {
    // Create unique temp directories
    testDir = join(tmpdir(), `track-edit-privacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storageDir = join(testDir, ".claude", "session-context", "handoffs");
    await mkdir(storageDir, { recursive: true });

    // Create config with tracking enabled
    const configPath = join(testDir, ".claude", "session-context", "config.json");
    const config = {
      tracking: {
        enabled: true,
        trackEdits: true,
      },
    };
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Override HOME to use test directory
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    hookPath = join(__dirname, "..", "track-edit.ts");
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

  test("does not track .env files", async () => {
    const toolInput = JSON.stringify({
      file_path: ".env",
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);

      // Run the hook
      await execFile("bun", [hookPath, "Write", toolInput, ""], {
        env: { ...process.env, HOME: testDir },
        cwd: testDir,
      });

      // Check that no checkpoint was created or .env is not in files
      const projectHash = require("crypto")
        .createHash("sha256")
        .update(testDir)
        .digest("hex")
        .slice(0, 8);

      const checkpointPath = join(
        storageDir,
        `${projectHash}-current.json`
      );

      try {
        const content = await readFile(checkpointPath, "utf-8");
        const checkpoint = JSON.parse(content);

        // If checkpoint exists, .env should not be in files
        const envFile = checkpoint.context.files.find((f: any) => f.path === ".env");
        expect(envFile).toBeUndefined();
      } catch (err: any) {
        // File not existing is also acceptable (no checkpoint created)
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("does not track files in secrets directory", async () => {
    const toolInput = JSON.stringify({
      file_path: "secrets/api-key.txt",
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);

      await execFile("bun", [hookPath, "Write", toolInput, ""], {
        env: { ...process.env, HOME: testDir },
        cwd: testDir,
      });

      const projectHash = require("crypto")
        .createHash("sha256")
        .update(testDir)
        .digest("hex")
        .slice(0, 8);

      const checkpointPath = join(
        storageDir,
        `${projectHash}-current.json`
      );

      try {
        const content = await readFile(checkpointPath, "utf-8");
        const checkpoint = JSON.parse(content);

        const secretFile = checkpoint.context.files.find(
          (f: any) => f.path === "secrets/api-key.txt"
        );
        expect(secretFile).toBeUndefined();
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("tracks normal files", async () => {
    const toolInput = JSON.stringify({
      file_path: "src/index.ts",
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);

      // Run the hook - should create a checkpoint
      const result = await execFile("bun", [hookPath, "Write", toolInput, ""], {
        env: { ...process.env, HOME: testDir },
        cwd: testDir,
      });

      // Hook should exit cleanly
      expect(result.stderr).toBe("");

      const projectHash = require("crypto")
        .createHash("sha256")
        .update(testDir)
        .digest("hex")
        .slice(0, 8);

      const checkpointPath = join(
        storageDir,
        `${projectHash}-current.json`
      );

      // Checkpoint should be created with the normal file
      const content = await readFile(checkpointPath, "utf-8");
      const checkpoint = JSON.parse(content);

      const normalFile = checkpoint.context.files.find(
        (f: any) => f.path === "src/index.ts"
      );
      expect(normalFile).toBeDefined();
      expect(normalFile.path).toBe("src/index.ts");
      expect(normalFile.role).toBe("created/overwritten");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
