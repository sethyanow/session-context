/**
 * Integration tests: Schema Validation
 *
 * Tests for handoff schema validation to ensure malformed data is handled gracefully
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  updateRollingCheckpoint,
  createExplicitHandoff,
  readHandoff,
  getProjectHash,
} from "../../mcp/src/storage/handoffs.js";
import { validateHandoff } from "../../mcp/src/storage/schema.js";

describe("Schema Validation", () => {
  let testProjectRoot: string;
  let testHome: string;
  let testStorageDir: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    const testId = `schema-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testProjectRoot = join(tmpdir(), testId, "project");
    testHome = join(tmpdir(), testId, "home");
    testStorageDir = join(testHome, ".claude", "session-context", "handoffs");

    await mkdir(testProjectRoot, { recursive: true });
    await mkdir(testStorageDir, { recursive: true });

    // Init git repo
    const { spawn } = await import("bun");
    await spawn(["git", "init"], {
      cwd: testProjectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;

    process.env.HOME = testHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;

    try {
      const baseDir = testProjectRoot.split("/").slice(0, -1).join("/");
      await rm(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("validateHandoff function", () => {
    test("accepts valid handoff with all fields", () => {
      const validHandoff = {
        id: "test1",
        version: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ttl: "7d",
        project: {
          root: "/test/project",
          hash: "abc12345",
          branch: "main",
        },
        context: {
          task: "Test task",
          summary: "",
          state: "in_progress",
          files: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
          userDecisions: [],
        },
        todos: [],
        references: {},
      };

      const result = validateHandoff(validHandoff);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBeDefined();
    });

    test("rejects non-object data", () => {
      expect(validateHandoff(null).valid).toBe(false);
      expect(validateHandoff("string").valid).toBe(false);
      expect(validateHandoff(123).valid).toBe(false);
      expect(validateHandoff(undefined).valid).toBe(false);
    });

    test("rejects missing required fields", () => {
      const incomplete = { id: "test" };

      const result = validateHandoff(incomplete);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    });

    test("rejects unsupported version", () => {
      const futureVersion = {
        id: "future",
        version: 99,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ttl: "7d",
        project: { root: "/", hash: "abc", branch: "main" },
        context: {
          task: "Test",
          summary: "",
          state: "in_progress",
          files: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
          userDecisions: [],
        },
        todos: [],
        references: {},
      };

      const result = validateHandoff(futureVersion);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("version: 99"))).toBe(true);
    });

    test("rejects missing project fields", () => {
      const missingProject = {
        id: "test",
        version: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ttl: "7d",
        project: { root: "/test" }, // Missing hash and branch
        context: {
          task: "Test",
          summary: "",
          state: "in_progress",
          files: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
          userDecisions: [],
        },
        todos: [],
      };

      const result = validateHandoff(missingProject);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("project.hash"))).toBe(true);
      expect(result.errors.some((e) => e.includes("project.branch"))).toBe(
        true,
      );
    });

    test("rejects missing context arrays", () => {
      const missingArrays = {
        id: "test",
        version: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ttl: "7d",
        project: { root: "/", hash: "abc", branch: "main" },
        context: {
          task: "Test",
          summary: "",
          state: "in_progress",
          // Missing: files, decisions, blockers, nextSteps, userDecisions
        },
        todos: [],
      };

      const result = validateHandoff(missingArrays);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("files"))).toBe(true);
    });
  });

  describe("readHandoff with validation", () => {
    test("returns null for corrupted JSON", async () => {
      const hash = getProjectHash(testProjectRoot);
      const path = join(testStorageDir, `${hash}.corrupted.json`);
      await writeFile(path, "{ not valid json {{{}");

      const result = await readHandoff("corrupted", false, hash);

      expect(result).toBeNull();
    });

    test("returns null for invalid handoff schema", async () => {
      const hash = getProjectHash(testProjectRoot);
      const path = join(testStorageDir, `${hash}.invalid.json`);

      // Write valid JSON but invalid handoff schema
      await writeFile(path, JSON.stringify({ id: "invalid", random: "data" }));

      const result = await readHandoff("invalid", false, hash);

      expect(result).toBeNull();
    });

    test("returns valid handoff when schema is correct", async () => {
      // Create a valid handoff through the normal flow
      await updateRollingCheckpoint(testProjectRoot, "main", {
        task: "Valid test",
      });

      const handoff = await createExplicitHandoff(testProjectRoot, {
        task: "Valid test",
      });

      const hash = getProjectHash(testProjectRoot);
      const recovered = await readHandoff(handoff.id, false, hash);

      expect(recovered).not.toBeNull();
      expect(recovered?.id).toBe(handoff.id);
      expect(recovered?.context.task).toBe("Valid test");
    });

    test("returns null for handoff with future version", async () => {
      const hash = getProjectHash(testProjectRoot);
      const path = join(testStorageDir, `${hash}.future.json`);

      const futureHandoff = {
        id: "future",
        version: 999, // Future version
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ttl: "7d",
        project: { root: testProjectRoot, hash, branch: "main" },
        context: {
          task: "Test",
          summary: "",
          state: "in_progress",
          files: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
          userDecisions: [],
        },
        todos: [],
        references: {},
      };

      await writeFile(path, JSON.stringify(futureHandoff));

      const result = await readHandoff("future", false, hash);

      expect(result).toBeNull();
    });
  });
});
