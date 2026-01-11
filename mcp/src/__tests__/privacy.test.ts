#!/usr/bin/env bun
/**
 * Tests for privacy exclusion patterns
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { updateRollingCheckpoint, getProjectHash } from "../storage/handoffs.js";
import { shouldExcludeFile } from "../utils/privacy.js";

describe("privacy exclusions", () => {
  describe("shouldExcludeFile", () => {
    test("excludes .env files", () => {
      expect(shouldExcludeFile(".env", ["**/.env*"])).toBe(true);
      expect(shouldExcludeFile(".env.local", ["**/.env*"])).toBe(true);
      expect(shouldExcludeFile(".env.production", ["**/.env*"])).toBe(true);
      expect(shouldExcludeFile("config/.env", ["**/.env*"])).toBe(true);
    });

    test("excludes secrets directories", () => {
      expect(shouldExcludeFile("secrets/api-key.txt", ["**/secrets/**"])).toBe(true);
      expect(shouldExcludeFile("config/secrets/db.json", ["**/secrets/**"])).toBe(true);
      expect(shouldExcludeFile("secrets/nested/deep/file.txt", ["**/secrets/**"])).toBe(true);
    });

    test("excludes credentials files", () => {
      expect(shouldExcludeFile("credentials.json", ["**/credentials*"])).toBe(true);
      expect(shouldExcludeFile("credentials.yml", ["**/credentials*"])).toBe(true);
      expect(shouldExcludeFile("config/credentials.txt", ["**/credentials*"])).toBe(true);
    });

    test("does not exclude normal files", () => {
      expect(shouldExcludeFile("src/index.ts", ["**/.env*", "**/secrets/**"])).toBe(false);
      expect(shouldExcludeFile("README.md", ["**/.env*", "**/secrets/**"])).toBe(false);
      expect(shouldExcludeFile("package.json", ["**/.env*", "**/secrets/**"])).toBe(false);
    });

    test("handles multiple patterns", () => {
      const patterns = ["**/.env*", "**/secrets/**", "**/credentials*"];

      expect(shouldExcludeFile(".env", patterns)).toBe(true);
      expect(shouldExcludeFile("secrets/key.txt", patterns)).toBe(true);
      expect(shouldExcludeFile("credentials.json", patterns)).toBe(true);
      expect(shouldExcludeFile("src/index.ts", patterns)).toBe(false);
    });

    test("handles empty patterns", () => {
      expect(shouldExcludeFile(".env", [])).toBe(false);
      expect(shouldExcludeFile("secrets/key.txt", [])).toBe(false);
    });

    test("handles absolute paths", () => {
      expect(shouldExcludeFile("/home/user/project/.env", ["**/.env*"])).toBe(true);
      expect(shouldExcludeFile("/home/user/project/secrets/key.txt", ["**/secrets/**"])).toBe(true);
    });
  });

  describe("updateRollingCheckpoint with privacy exclusions", () => {
    let testDir: string;
    let storageDir: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
      testDir = join(tmpdir(), `privacy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(testDir, { recursive: true });

      // Create a mock HOME directory for handoff storage
      storageDir = join(testDir, ".claude", "session-context", "handoffs");
      await mkdir(storageDir, { recursive: true });

      // Override HOME to use test directory
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

    test("filters out .env files from tracked files", async () => {
      const files = [
        { path: "src/index.ts", role: "modified" },
        { path: ".env", role: "modified" },
        { path: ".env.local", role: "modified" },
        { path: "README.md", role: "modified" },
      ];

      const handoff = await updateRollingCheckpoint(testDir, "main", { files });

      // Should only have src/index.ts and README.md
      expect(handoff.context.files).toHaveLength(2);
      expect(handoff.context.files.map(f => f.path)).toEqual([
        "src/index.ts",
        "README.md",
      ]);
    });

    test("filters out secrets directory files", async () => {
      const files = [
        { path: "src/index.ts", role: "modified" },
        { path: "secrets/api-key.txt", role: "modified" },
        { path: "config/secrets/db.json", role: "modified" },
        { path: "README.md", role: "modified" },
      ];

      const handoff = await updateRollingCheckpoint(testDir, "main", { files });

      expect(handoff.context.files).toHaveLength(2);
      expect(handoff.context.files.map(f => f.path)).toEqual([
        "src/index.ts",
        "README.md",
      ]);
    });

    test("filters out credentials files", async () => {
      const files = [
        { path: "src/index.ts", role: "modified" },
        { path: "credentials.json", role: "modified" },
        { path: "config/credentials.yml", role: "modified" },
        { path: "README.md", role: "modified" },
      ];

      const handoff = await updateRollingCheckpoint(testDir, "main", { files });

      expect(handoff.context.files).toHaveLength(2);
      expect(handoff.context.files.map(f => f.path)).toEqual([
        "src/index.ts",
        "README.md",
      ]);
    });

    test("handles merging files with exclusions", async () => {
      // First update with allowed files
      const firstFiles = [
        { path: "src/index.ts", role: "modified" },
        { path: "README.md", role: "modified" },
      ];

      await updateRollingCheckpoint(testDir, "main", { files: firstFiles });

      // Second update adds more files including excluded ones
      const secondFiles = [
        { path: "src/index.ts", role: "updated" },
        { path: ".env", role: "modified" },
        { path: "src/utils.ts", role: "created" },
      ];

      const handoff = await updateRollingCheckpoint(testDir, "main", { files: secondFiles });

      // Should have index.ts (updated), README.md (from before), and utils.ts (new)
      // .env should be filtered out
      expect(handoff.context.files).toHaveLength(3);

      const filePaths = handoff.context.files.map(f => f.path).sort();
      expect(filePaths).toEqual([
        "README.md",
        "src/index.ts",
        "src/utils.ts",
      ]);
    });
  });
});
