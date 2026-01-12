#!/usr/bin/env bun
/**
 * Tests for privacy exclusions in track-edit hook
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile, realpath } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execFile = promisify(require("child_process").execFile);

// Get the hooks directory relative to this test file
const HOOKS_DIR = dirname(dirname(import.meta.path));

describe("track-edit hook privacy exclusions", () => {
  let testDir: string;
  let storageDir: string;
  let configPath: string;
  let hookPath: string;

  beforeEach(async () => {
    // Create unique temp directories
    const tempDir = join(tmpdir(), `track-edit-privacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    // Resolve symlinks (macOS /tmp -> /private/tmp) to get consistent hash
    testDir = await realpath(tempDir);
    storageDir = join(testDir, ".claude", "session-context", "handoffs");
    await mkdir(storageDir, { recursive: true });

    // Create config with tracking enabled
    configPath = join(testDir, ".claude", "session-context", "config.json");
    const config = {
      version: 1,
      tracking: {
        enabled: true,
        trackEdits: true,
        trackTodos: true,
        trackPlans: true,
        trackUserDecisions: true,
      },
    };
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Set environment variables for child process isolation
    process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;
    process.env.SESSION_CONTEXT_STORAGE_DIR = storageDir;

    hookPath = join(HOOKS_DIR, "track-edit.ts");
  });

  afterEach(async () => {
    // Clean up environment variables
    delete process.env.SESSION_CONTEXT_CONFIG_PATH;
    delete process.env.SESSION_CONTEXT_STORAGE_DIR;

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

    // Run the hook
    await execFile("bun", [hookPath, "Write", toolInput, ""], {
      env: {
        ...process.env,
        SESSION_CONTEXT_CONFIG_PATH: configPath,
        SESSION_CONTEXT_STORAGE_DIR: storageDir,
      },
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
  });

  test("does not track files in secrets directory", async () => {
    const toolInput = JSON.stringify({
      file_path: "secrets/api-key.txt",
    });

    await execFile("bun", [hookPath, "Write", toolInput, ""], {
      env: {
        ...process.env,
        SESSION_CONTEXT_CONFIG_PATH: configPath,
        SESSION_CONTEXT_STORAGE_DIR: storageDir,
      },
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
  });

  test("tracks normal files", async () => {
    const toolInput = JSON.stringify({
      file_path: "src/index.ts",
    });

    // Run the hook - should create a checkpoint
    const result = await execFile("bun", [hookPath, "Write", toolInput, ""], {
      env: {
        ...process.env,
        SESSION_CONTEXT_CONFIG_PATH: configPath,
        SESSION_CONTEXT_STORAGE_DIR: storageDir,
      },
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
  });
});
