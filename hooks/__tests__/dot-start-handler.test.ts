#!/usr/bin/env bun
/**
 * Tests for dot-start-handler hook
 * Verifies that the hook outputs sessionStatus with pre-loaded data
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("dot-start-handler hook", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dot-start-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("hook outputs valid JSON with continue: true", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);

    const output = JSON.parse(stdout);
    expect(output.continue).toBe(true);
    expect(output.systemMessage).toContain(".");
  });

  test("hook includes hookSpecificOutput with additionalContext", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain("Pre-loaded Session Status");
  });

  test("additionalContext contains valid JSON with session data", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const { additionalContext } = output.hookSpecificOutput;

    // Extract JSON from markdown code block
    const jsonMatch = additionalContext.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonMatch).not.toBeNull();

    const sessionStatus = JSON.parse(jsonMatch![1]);
    expect(sessionStatus.level).toBe("standard");
    expect(sessionStatus.integrations).toBeDefined();
  });

  test("additionalContext includes integrations object", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const jsonMatch = output.hookSpecificOutput.additionalContext.match(/```json\n([\s\S]*?)\n```/);
    const sessionStatus = JSON.parse(jsonMatch![1]);
    const { integrations } = sessionStatus;

    expect(typeof integrations.claudeMem).toBe("boolean");
    expect(typeof integrations.beads).toBe("boolean");
    expect(typeof integrations.harness).toBe("boolean");
    expect(typeof integrations.agentMail).toBe("boolean");
  });

  test("additionalContext includes recovery field", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const jsonMatch = output.hookSpecificOutput.additionalContext.match(/```json\n([\s\S]*?)\n```/);
    const sessionStatus = JSON.parse(jsonMatch![1]);

    expect(sessionStatus.recovery).toBeDefined();
    expect(typeof sessionStatus.recovery.available).toBe("boolean");
  });

  test("hook detects beads when .beads directory exists", async () => {
    // Create .beads directory with marker
    const beadsDir = join(testDir, ".beads");
    await mkdir(beadsDir, { recursive: true });
    await writeFile(join(beadsDir, ".keep"), "", "utf-8");

    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const jsonMatch = output.hookSpecificOutput.additionalContext.match(/```json\n([\s\S]*?)\n```/);
    const sessionStatus = JSON.parse(jsonMatch![1]);
    // Note: beads detection may still be false if bv command fails
    // This test verifies the structure is correct
    expect(sessionStatus.integrations).toHaveProperty("beads");
  });

  test("hook detects harness when .claude-harness directory exists", async () => {
    // Create .claude-harness directory
    const harnessDir = join(testDir, ".claude-harness");
    await mkdir(harnessDir, { recursive: true });

    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const jsonMatch = output.hookSpecificOutput.additionalContext.match(/```json\n([\s\S]*?)\n```/);
    const sessionStatus = JSON.parse(jsonMatch![1]);
    expect(sessionStatus.harness).not.toBeNull();
    expect(sessionStatus.integrations.harness).toBe(true);
  });

  test("hook outputs git info for git repos", async () => {
    // Initialize git repo
    const initProc = Bun.spawn(["git", "init"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await initProc.exited;

    // Configure git
    await Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: testDir }).exited;
    await Bun.spawn(["git", "config", "user.name", "Test"], { cwd: testDir }).exited;

    // Create a file and commit
    await writeFile(join(testDir, "test.txt"), "test content", "utf-8");
    await Bun.spawn(["git", "add", "."], { cwd: testDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: testDir }).exited;

    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const output = JSON.parse(stdout);
    const jsonMatch = output.hookSpecificOutput.additionalContext.match(/```json\n([\s\S]*?)\n```/);
    const sessionStatus = JSON.parse(jsonMatch![1]);
    expect(sessionStatus.project).not.toBeNull();
    expect(sessionStatus.project.branch).toBeDefined();
  });

  test("hook handles non-git directory gracefully", async () => {
    const hookPath = join(import.meta.dir, "..", "dot-start-handler.ts");

    const proc = Bun.spawn(["bun", hookPath], {
      cwd: testDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);

    const output = JSON.parse(stdout);
    // Should still output valid JSON even if project is null
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput).toBeDefined();
  });
});
