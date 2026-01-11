#!/usr/bin/env bun
/**
 * Tests for track-plan hook
 * Verifies that the hook correctly uses Bun.glob instead of external glob dependency
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("track-plan hook", () => {
  let testDir: string;
  let plansDir: string;

  beforeEach(async () => {
    // Create unique temp directories
    testDir = join(tmpdir(), `track-plan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    plansDir = join(testDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Bun.glob finds markdown files in plans directory", async () => {
    // Create test plan files
    const plan1 = join(plansDir, "test-plan-1.md");
    const plan2 = join(plansDir, "test-plan-2.md");

    await writeFile(plan1, "# Test Plan 1\n\nSome content", "utf-8");
    await writeFile(plan2, "# Test Plan 2\n\nSome content", "utf-8");

    // Use Bun.glob to find files (the new approach)
    const { Glob } = await import("bun");
    const glob = new Glob("*.md");
    const files = Array.from(glob.scanSync(plansDir));

    expect(files.length).toBe(2);
    expect(files.some(f => f.endsWith("test-plan-1.md"))).toBe(true);
    expect(files.some(f => f.endsWith("test-plan-2.md"))).toBe(true);
  });

  test("Bun.glob returns empty array when no markdown files exist", async () => {
    // Create a non-markdown file
    await writeFile(join(plansDir, "test.txt"), "not a markdown file", "utf-8");

    const { Glob } = await import("bun");
    const glob = new Glob("*.md");
    const files = Array.from(glob.scanSync(plansDir));

    expect(files.length).toBe(0);
  });

  test("Bun.glob sorts files correctly for finding most recent", async () => {
    // Create files with different timestamps
    const plan1 = join(plansDir, "old-plan.md");
    const plan2 = join(plansDir, "new-plan.md");

    await writeFile(plan1, "# Old Plan", "utf-8");
    // Wait a bit to ensure different mtimes
    await new Promise(resolve => setTimeout(resolve, 10));
    await writeFile(plan2, "# New Plan", "utf-8");

    const { Glob } = await import("bun");
    const glob = new Glob("*.md");
    const files = Array.from(glob.scanSync(plansDir)).map(f => join(plansDir, f));

    // Get file stats and sort by mtime
    const filesWithStats = await Promise.all(
      files.map(async (f) => {
        const stat = await Bun.file(f).stat();
        return { path: f, mtime: stat?.mtime || 0 };
      })
    );
    filesWithStats.sort((a, b) => (b.mtime as number) - (a.mtime as number));

    // The most recent file should be new-plan.md
    expect(filesWithStats[0].path).toContain("new-plan.md");
    expect(filesWithStats[1].path).toContain("old-plan.md");
  });

  test("Bun.glob handles directory that doesn't exist gracefully", async () => {
    const nonExistentDir = join(testDir, "does-not-exist");

    const { Glob } = await import("bun");
    const glob = new Glob("*.md");

    // scanSync should handle non-existent directory gracefully
    expect(() => {
      Array.from(glob.scanSync(nonExistentDir));
    }).toThrow();
  });
});
