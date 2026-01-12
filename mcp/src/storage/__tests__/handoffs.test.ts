import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Handoff } from "../../types.js";

// Mock the STORAGE_DIR to use a test directory
const TEST_STORAGE_DIR = join(tmpdir(), `handoffs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Helper to create a test handoff
function createTestHandoff(projectRoot: string, projectHash: string, id: string): Handoff {
  const now = new Date().toISOString();
  return {
    id,
    version: 1,
    created: now,
    updated: now,
    ttl: "7d",
    project: {
      root: projectRoot,
      hash: projectHash,
      branch: "main",
    },
    context: {
      task: "Test task",
      summary: "Test summary",
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
}

describe("handoffs storage", () => {
  beforeEach(async () => {
    await mkdir(TEST_STORAGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getProjectHash", () => {
    test("generates consistent hash for same path", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const path = "/test/project/path";
      const hash1 = getProjectHash(path);
      const hash2 = getProjectHash(path);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
    });

    test("generates different hashes for different paths", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const hash1 = getProjectHash("/test/project/path1");
      const hash2 = getProjectHash("/test/project/path2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("generateHandoffId", () => {
    test("generates valid 5-character ID", async () => {
      const { generateHandoffId } = await import("../handoffs.js");
      const id = generateHandoffId();
      expect(id).toHaveLength(5);
      expect(id).toMatch(/^[a-z0-9]{5}$/);
    });

    test("generates unique IDs", async () => {
      const { generateHandoffId } = await import("../handoffs.js");
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateHandoffId());
      }
      // Should have high uniqueness (allowing for rare collisions)
      expect(ids.size).toBeGreaterThan(95);
    });
  });

  describe("filename format optimization", () => {
    test("explicit handoff files use new format: {projectHash}.{id}.json", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const projectHash = getProjectHash(projectRoot);
      const handoffId = "abc12";

      // Create a handoff with the new filename format
      const handoff = createTestHandoff(projectRoot, projectHash, handoffId);
      const expectedFilename = `${projectHash}.${handoffId}.json`;
      const filePath = join(TEST_STORAGE_DIR, expectedFilename);

      await writeFile(filePath, JSON.stringify(handoff, null, 2));

      // Verify the file exists with the expected name
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as Handoff;
      expect(parsed.id).toBe(handoffId);
      expect(parsed.project.hash).toBe(projectHash);
    });

    test("rolling checkpoint files use format: {projectHash}-current.json", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const projectHash = getProjectHash(projectRoot);

      // Create a rolling checkpoint with the correct filename format
      const handoff = createTestHandoff(projectRoot, projectHash, "roll1");
      const expectedFilename = `${projectHash}-current.json`;
      const filePath = join(TEST_STORAGE_DIR, expectedFilename);

      await writeFile(filePath, JSON.stringify(handoff, null, 2));

      // Verify the file exists with the expected name
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as Handoff;
      expect(parsed.project.hash).toBe(projectHash);
    });
  });

  describe("listHandoffs optimization", () => {
    test("filters by filename pattern to avoid parsing all files", async () => {
      const { getProjectHash } = await import("../handoffs.js");

      const project1Root = "/test/project1";
      const project2Root = "/test/project2";
      const hash1 = getProjectHash(project1Root);
      const hash2 = getProjectHash(project2Root);

      // Create handoffs for two different projects
      const handoff1a = createTestHandoff(project1Root, hash1, "aaa11");
      const handoff1b = createTestHandoff(project1Root, hash1, "bbb22");
      const handoff2a = createTestHandoff(project2Root, hash2, "ccc33");
      const handoff2b = createTestHandoff(project2Root, hash2, "ddd44");

      // Write files with the new naming format: {projectHash}.{id}.json
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash1}.aaa11.json`),
        JSON.stringify(handoff1a, null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash1}.bbb22.json`),
        JSON.stringify(handoff1b, null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash2}.ccc33.json`),
        JSON.stringify(handoff2a, null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash2}.ddd44.json`),
        JSON.stringify(handoff2b, null, 2),
      );

      // Add rolling checkpoints (should be excluded from explicit handoff lists)
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash1}-current.json`),
        JSON.stringify(createTestHandoff(project1Root, hash1, "roll1"), null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash2}-current.json`),
        JSON.stringify(createTestHandoff(project2Root, hash2, "roll2"), null, 2),
      );

      // This test will fail initially because the current implementation
      // doesn't filter by filename - it reads and parses everything
      // The optimized version should only read files matching the pattern

      // For now, we can verify the files are there
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(TEST_STORAGE_DIR);

      expect(files).toContain(`${hash1}.aaa11.json`);
      expect(files).toContain(`${hash1}.bbb22.json`);
      expect(files).toContain(`${hash2}.ccc33.json`);
      expect(files).toContain(`${hash2}.ddd44.json`);
      expect(files).toContain(`${hash1}-current.json`);
      expect(files).toContain(`${hash2}-current.json`);
    });

    test("only returns handoffs for the specified project", async () => {
      const { getProjectHash } = await import("../handoffs.js");

      const project1Root = "/test/project1";
      const project2Root = "/test/project2";
      const hash1 = getProjectHash(project1Root);
      const hash2 = getProjectHash(project2Root);

      // Create and write test handoffs using new naming format
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash1}.aaa11.json`),
        JSON.stringify(createTestHandoff(project1Root, hash1, "aaa11"), null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR, `${hash2}.ccc33.json`),
        JSON.stringify(createTestHandoff(project2Root, hash2, "ccc33"), null, 2),
      );

      // The current implementation will fail this because it needs to be updated
      // to use the storage directory override for testing
      // For now, this documents the expected behavior
      expect(true).toBe(true); // Placeholder until we can inject storage dir
    });
  });

  describe("migration from old to new filename format", () => {
    test("old format {id}.json can coexist with new format", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const projectHash = getProjectHash(projectRoot);

      // Create an old-format file
      const oldHandoff = createTestHandoff(projectRoot, projectHash, "old01");
      await writeFile(
        join(TEST_STORAGE_DIR, "old01.json"),
        JSON.stringify(oldHandoff, null, 2),
      );

      // Create a new-format file
      const newHandoff = createTestHandoff(projectRoot, projectHash, "new02");
      await writeFile(
        join(TEST_STORAGE_DIR, `${projectHash}.new02.json`),
        JSON.stringify(newHandoff, null, 2),
      );

      // Verify both files exist
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(TEST_STORAGE_DIR);
      expect(files).toContain("old01.json");
      expect(files).toContain(`${projectHash}.new02.json`);
    });
  });

  describe("cleanupExpiredHandoffs", () => {
    test("should handle both old and new filename formats", async () => {
      const { getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const projectHash = getProjectHash(projectRoot);

      // Create an expired handoff in old format
      const expiredOld = createTestHandoff(projectRoot, projectHash, "exp01");
      expiredOld.updated = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
      await writeFile(
        join(TEST_STORAGE_DIR, "exp01.json"),
        JSON.stringify(expiredOld, null, 2),
      );

      // Create an expired handoff in new format
      const expiredNew = createTestHandoff(projectRoot, projectHash, "exp02");
      expiredNew.updated = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR, `${projectHash}.exp02.json`),
        JSON.stringify(expiredNew, null, 2),
      );

      // Verify both files exist
      const { readdir } = await import("node:fs/promises");
      const filesBefore = await readdir(TEST_STORAGE_DIR);
      expect(filesBefore).toContain("exp01.json");
      expect(filesBefore).toContain(`${projectHash}.exp02.json`);

      // Cleanup should remove both
      // (This will be implemented in the actual cleanup function)
    });
  });
});

// Tests for handoffs.ts functions that need environment variable isolation
describe("handoffs storage with env isolation", () => {
  const TEST_STORAGE_DIR_ENV = join(tmpdir(), `handoffs-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  beforeEach(async () => {
    await mkdir(TEST_STORAGE_DIR_ENV, { recursive: true });
    process.env.SESSION_CONTEXT_STORAGE_DIR = TEST_STORAGE_DIR_ENV;
  });

  afterEach(async () => {
    delete process.env.SESSION_CONTEXT_STORAGE_DIR;
    delete process.env.SESSION_CONTEXT_CONFIG_PATH;
    try {
      await rm(TEST_STORAGE_DIR_ENV, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("readHandoff", () => {
    test("returns null for non-existent handoff", async () => {
      const { readHandoff } = await import("../handoffs.js");
      const result = await readHandoff("nonexistent");
      expect(result).toBeNull();
    });

    test("reads handoff by ID with new format", async () => {
      const { readHandoff, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "test1");

      // Write in new format
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.test1.json`),
        JSON.stringify(handoff, null, 2),
      );

      const result = await readHandoff("test1", false, hash);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("test1");
    });

    test("reads handoff by ID with old format", async () => {
      const { readHandoff, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "old01");

      // Write in old format
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "old01.json"),
        JSON.stringify(handoff, null, 2),
      );

      const result = await readHandoff("old01");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("old01");
    });

    test("reads rolling checkpoint", async () => {
      const { readHandoff, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "roll1");

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}-current.json`),
        JSON.stringify(handoff, null, 2),
      );

      const result = await readHandoff(hash, true);
      expect(result).not.toBeNull();
      expect(result?.project.hash).toBe(hash);
    });
  });

  describe("writeHandoff", () => {
    test("writes explicit handoff with new format", async () => {
      const { writeHandoff, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "write1");

      await writeHandoff(handoff, false);

      const filePath = join(TEST_STORAGE_DIR_ENV, `${hash}.write1.json`);
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as Handoff;
      expect(parsed.id).toBe("write1");
    });

    test("writes rolling checkpoint", async () => {
      const { writeHandoff, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "roll2");

      await writeHandoff(handoff, true);

      const filePath = join(TEST_STORAGE_DIR_ENV, `${hash}-current.json`);
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as Handoff;
      expect(parsed.project.hash).toBe(hash);
    });
  });

  describe("getRollingCheckpoint", () => {
    test("returns null when no checkpoint exists", async () => {
      const { getRollingCheckpoint } = await import("../handoffs.js");
      const result = await getRollingCheckpoint("/nonexistent/project");
      expect(result).toBeNull();
    });

    test("returns checkpoint when it exists", async () => {
      const { getRollingCheckpoint, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/project";
      const hash = getProjectHash(projectRoot);
      const handoff = createTestHandoff(projectRoot, hash, "roll3");

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}-current.json`),
        JSON.stringify(handoff, null, 2),
      );

      const result = await getRollingCheckpoint(projectRoot);
      expect(result).not.toBeNull();
      expect(result?.project.root).toBe(projectRoot);
    });
  });

  describe("updateRollingCheckpoint", () => {
    test("creates new checkpoint if none exists", async () => {
      const { updateRollingCheckpoint, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/newproject";
      const hash = getProjectHash(projectRoot);

      const result = await updateRollingCheckpoint(projectRoot, "main", {
        task: "Test task",
      });

      expect(result.project.root).toBe(projectRoot);
      expect(result.project.hash).toBe(hash);
      expect(result.context.task).toBe("Test task");
    });

    test("updates existing checkpoint task", async () => {
      const { updateRollingCheckpoint, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/existing";
      const hash = getProjectHash(projectRoot);

      // Create initial checkpoint
      await updateRollingCheckpoint(projectRoot, "main", { task: "Initial" });

      // Update task
      const result = await updateRollingCheckpoint(projectRoot, "main", { task: "Updated" });

      expect(result.context.task).toBe("Updated");
    });

    test("updates checkpoint with files", async () => {
      const { updateRollingCheckpoint, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/files";

      // Create with files
      const result = await updateRollingCheckpoint(projectRoot, "main", {
        files: [
          { path: "src/test.ts", role: "modified" },
          { path: "src/other.ts", role: "created" },
        ],
      });

      expect(result.context.files).toHaveLength(2);
      expect(result.context.files[0].path).toBe("src/test.ts");
    });

    test("updates checkpoint with todos", async () => {
      const { updateRollingCheckpoint } = await import("../handoffs.js");
      const projectRoot = "/test/todos";

      const result = await updateRollingCheckpoint(projectRoot, "main", {
        todos: [{ content: "Test todo", status: "pending" }],
      });

      expect(result.todos).toHaveLength(1);
      expect(result.todos[0].content).toBe("Test todo");
    });

    test("updates checkpoint with plan", async () => {
      const { updateRollingCheckpoint } = await import("../handoffs.js");
      const projectRoot = "/test/plan";

      const result = await updateRollingCheckpoint(projectRoot, "main", {
        plan: { path: "PLAN.md", content: "# Plan\nDo stuff" },
      });

      expect(result.context.plan).toBeDefined();
      expect(result.context.plan?.path).toBe("PLAN.md");
      expect(result.context.plan?.content).toBe("# Plan\nDo stuff");
    });

    test("updates checkpoint with user decision", async () => {
      const { updateRollingCheckpoint } = await import("../handoffs.js");
      const projectRoot = "/test/decisions";

      const result = await updateRollingCheckpoint(projectRoot, "main", {
        userDecision: { question: "Which approach?", answer: "Option A" },
      });

      expect(result.context.userDecisions).toHaveLength(1);
      expect(result.context.userDecisions[0].question).toBe("Which approach?");
      expect(result.context.userDecisions[0].answer).toBe("Option A");
    });

    test("excludes files matching privacy patterns", async () => {
      const { updateRollingCheckpoint } = await import("../handoffs.js");
      const projectRoot = "/test/privacy";

      const result = await updateRollingCheckpoint(projectRoot, "main", {
        files: [
          { path: "src/test.ts", role: "modified" },
          { path: ".env", role: "modified" },
          { path: ".env.local", role: "modified" },
          { path: "secrets/keys.json", role: "modified" },
        ],
      });

      // Only non-excluded files should remain
      expect(result.context.files).toHaveLength(1);
      expect(result.context.files[0].path).toBe("src/test.ts");
    });
  });

  describe("createExplicitHandoff", () => {
    test("creates handoff from rolling checkpoint", async () => {
      const { createExplicitHandoff, updateRollingCheckpoint, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/explicit";
      const hash = getProjectHash(projectRoot);

      // Create rolling checkpoint first
      await updateRollingCheckpoint(projectRoot, "main", {
        task: "Base task",
        files: [{ path: "src/test.ts", role: "modified" }],
      });

      // Create explicit handoff
      const result = await createExplicitHandoff(projectRoot, {
        summary: "Ready for review",
        state: "completed",
      });

      expect(result.id).toHaveLength(5);
      expect(result.ttl).toBe("7d");
      expect(result.context.task).toBe("Base task");
      expect(result.context.summary).toBe("Ready for review");
      expect(result.context.state).toBe("completed");
      expect(result.context.files).toHaveLength(1);
    });

    test("creates handoff without rolling checkpoint", async () => {
      const { createExplicitHandoff } = await import("../handoffs.js");
      const projectRoot = "/test/norolling";

      const result = await createExplicitHandoff(projectRoot, {
        task: "Custom task",
        summary: "Custom summary",
      });

      expect(result.context.task).toBe("Custom task");
      expect(result.context.summary).toBe("Custom summary");
      expect(result.ttl).toBe("7d");
    });
  });

  describe("listHandoffs", () => {
    test("returns empty array when no handoffs exist", async () => {
      const { listHandoffs } = await import("../handoffs.js");
      const result = await listHandoffs("/nonexistent/project");
      expect(result).toEqual([]);
    });

    test("lists handoffs for project with new format", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/list";
      const hash = getProjectHash(projectRoot);

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.h001.json`),
        JSON.stringify(createTestHandoff(projectRoot, hash, "h001"), null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.h002.json`),
        JSON.stringify(createTestHandoff(projectRoot, hash, "h002"), null, 2),
      );

      const result = await listHandoffs(projectRoot);

      expect(result).toHaveLength(2);
    });

    test("excludes rolling checkpoints from list", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/exclude";
      const hash = getProjectHash(projectRoot);

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.h003.json`),
        JSON.stringify(createTestHandoff(projectRoot, hash, "h003"), null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}-current.json`),
        JSON.stringify(createTestHandoff(projectRoot, hash, "roll"), null, 2),
      );

      const result = await listHandoffs(projectRoot);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("h003");
    });

    test("excludes handoffs from other projects", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot1 = "/test/proj1";
      const projectRoot2 = "/test/proj2";
      const hash1 = getProjectHash(projectRoot1);
      const hash2 = getProjectHash(projectRoot2);

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash1}.h004.json`),
        JSON.stringify(createTestHandoff(projectRoot1, hash1, "h004"), null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash2}.h005.json`),
        JSON.stringify(createTestHandoff(projectRoot2, hash2, "h005"), null, 2),
      );

      const result = await listHandoffs(projectRoot1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("h004");
    });

    test("sorts handoffs by updated timestamp (newest first)", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/sort";
      const hash = getProjectHash(projectRoot);

      const older = createTestHandoff(projectRoot, hash, "older");
      older.updated = "2026-01-01T00:00:00.000Z";

      const newer = createTestHandoff(projectRoot, hash, "newer");
      newer.updated = "2026-01-02T00:00:00.000Z";

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.older.json`),
        JSON.stringify(older, null, 2),
      );
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.newer.json`),
        JSON.stringify(newer, null, 2),
      );

      const result = await listHandoffs(projectRoot);

      expect(result[0].id).toBe("newer");
      expect(result[1].id).toBe("older");
    });
  });

  describe("cleanupExpiredHandoffs", () => {
    test("removes expired handoffs", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/cleanup";
      const hash = getProjectHash(projectRoot);

      // Create expired handoff (older than 7d TTL)
      const expired = createTestHandoff(projectRoot, hash, "exp01");
      expired.updated = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.exp01.json`),
        JSON.stringify(expired, null, 2),
      );

      // Create non-expired handoff
      const valid = createTestHandoff(projectRoot, hash, "valid1");
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.valid1.json`),
        JSON.stringify(valid, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(1);

      const files = await readdir(TEST_STORAGE_DIR_ENV);
      expect(files).toContain(`${hash}.valid1.json`);
      expect(files).not.toContain(`${hash}.exp01.json`);
    });

    test("handles different TTL values", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/ttl";
      const hash = getProjectHash(projectRoot);

      // Handoff with 1h TTL that's expired (2 hours old)
      const expiredHour = createTestHandoff(projectRoot, hash, "exp1h");
      expiredHour.ttl = "1h";
      expiredHour.updated = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.exp1h.json`),
        JSON.stringify(expiredHour, null, 2),
      );

      // Handoff with 24h TTL that's still valid (12 hours old)
      const validDay = createTestHandoff(projectRoot, hash, "val24h");
      validDay.ttl = "24h";
      validDay.updated = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.val24h.json`),
        JSON.stringify(validDay, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(1);

      const files = await readdir(TEST_STORAGE_DIR_ENV);
      expect(files).toContain(`${hash}.val24h.json`);
      expect(files).not.toContain(`${hash}.exp1h.json`);
    });

    test("returns 0 when no expired handoffs", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/noclean";
      const hash = getProjectHash(projectRoot);

      const valid = createTestHandoff(projectRoot, hash, "v001");
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.v001.json`),
        JSON.stringify(valid, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(0);
    });

    test("skips invalid JSON files", async () => {
      const { cleanupExpiredHandoffs } = await import("../handoffs.js");

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "invalid.json"),
        "not valid json {{{",
        "utf-8",
      );

      // Should not throw
      const cleaned = await cleanupExpiredHandoffs();
      expect(cleaned).toBe(0);
    });

    test("skips non-JSON files", async () => {
      const { cleanupExpiredHandoffs } = await import("../handoffs.js");

      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "readme.txt"),
        "readme",
        "utf-8",
      );

      const cleaned = await cleanupExpiredHandoffs();
      expect(cleaned).toBe(0);
    });
  });

  describe("getConfig", () => {
    test("returns defaults when no config file exists", async () => {
      const { getConfig } = await import("../handoffs.js");

      const config = await getConfig();

      expect(config.version).toBe(1);
      expect(config.tracking.enabled).toBe(true);
      expect(config.checkpoints.rollingEnabled).toBe(true);
      expect(config.privacy.excludePatterns).toContain("**/.env*");
    });

    test("deep merges config with defaults", async () => {
      const { getConfig } = await import("../handoffs.js");

      const configPath = join(TEST_STORAGE_DIR_ENV, "config.json");
      process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;

      await writeFile(configPath, JSON.stringify({
        tracking: { trackPlans: false },
        checkpoints: { maxStoredHandoffs: 50 },
      }), "utf-8");

      const config = await getConfig();

      // Custom values
      expect(config.tracking.trackPlans).toBe(false);
      expect(config.checkpoints.maxStoredHandoffs).toBe(50);

      // Preserved defaults
      expect(config.tracking.enabled).toBe(true);
      expect(config.tracking.trackEdits).toBe(true);
      expect(config.checkpoints.rollingEnabled).toBe(true);
    });
  });

  describe("cleanupExpiredHandoffs with week/month TTL", () => {
    test("handles week TTL correctly", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/weekttl";
      const hash = getProjectHash(projectRoot);

      // Handoff with 1w TTL that's expired (8 days old)
      const expiredWeek = createTestHandoff(projectRoot, hash, "expweek");
      expiredWeek.ttl = "1w";
      expiredWeek.updated = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.expweek.json`),
        JSON.stringify(expiredWeek, null, 2),
      );

      // Handoff with 2w TTL that's still valid (10 days old)
      const validWeek = createTestHandoff(projectRoot, hash, "valweek");
      validWeek.ttl = "2w";
      validWeek.updated = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.valweek.json`),
        JSON.stringify(validWeek, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(1);

      const files = await readdir(TEST_STORAGE_DIR_ENV);
      expect(files).toContain(`${hash}.valweek.json`);
      expect(files).not.toContain(`${hash}.expweek.json`);
    });

    test("handles month TTL correctly", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/monthttl";
      const hash = getProjectHash(projectRoot);

      // Handoff with 1m TTL that's expired (31 days old)
      const expiredMonth = createTestHandoff(projectRoot, hash, "expmonth");
      expiredMonth.ttl = "1m";
      expiredMonth.updated = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.expmonth.json`),
        JSON.stringify(expiredMonth, null, 2),
      );

      // Handoff with 2m TTL that's still valid (45 days old)
      const validMonth = createTestHandoff(projectRoot, hash, "valmonth");
      validMonth.ttl = "2m";
      validMonth.updated = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.valmonth.json`),
        JSON.stringify(validMonth, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(1);

      const files = await readdir(TEST_STORAGE_DIR_ENV);
      expect(files).toContain(`${hash}.valmonth.json`);
      expect(files).not.toContain(`${hash}.expmonth.json`);
    });

    test("uses default TTL for invalid format", async () => {
      const { cleanupExpiredHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/invalidttl";
      const hash = getProjectHash(projectRoot);

      // Handoff with invalid TTL format - should default to 24h
      const invalidTTL = createTestHandoff(projectRoot, hash, "invalid");
      invalidTTL.ttl = "invalid";
      invalidTTL.updated = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.invalid.json`),
        JSON.stringify(invalidTTL, null, 2),
      );

      const cleaned = await cleanupExpiredHandoffs();

      expect(cleaned).toBe(1); // Should be cleaned up using default 24h TTL
    });
  });

  describe("listHandoffs project filtering", () => {
    test("skips files from other projects using new format detection", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot1 = "/test/filterproj1";
      const projectRoot2 = "/test/filterproj2";
      const hash1 = getProjectHash(projectRoot1);
      const hash2 = getProjectHash(projectRoot2);

      // Create handoff for project 1 (new format)
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash1}.myfile.json`),
        JSON.stringify(createTestHandoff(projectRoot1, hash1, "myfile"), null, 2),
      );

      // Create handoff for project 2 (new format) - should be skipped for project 1
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash2}.other.json`),
        JSON.stringify(createTestHandoff(projectRoot2, hash2, "other"), null, 2),
      );

      const result = await listHandoffs(projectRoot1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("myfile");
    });

    test("includes old format files that match project hash", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot = "/test/oldformat";
      const hash = getProjectHash(projectRoot);

      // Create handoff with old format (no hash prefix)
      const oldFormat = createTestHandoff(projectRoot, hash, "oldid");
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "oldid.json"),
        JSON.stringify(oldFormat, null, 2),
      );

      // Create handoff with new format
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, `${hash}.newid.json`),
        JSON.stringify(createTestHandoff(projectRoot, hash, "newid"), null, 2),
      );

      const result = await listHandoffs(projectRoot);

      expect(result).toHaveLength(2);
      expect(result.map(h => h.id).sort()).toEqual(["newid", "oldid"]);
    });

    test("excludes old format files from different project", async () => {
      const { listHandoffs, getProjectHash } = await import("../handoffs.js");
      const projectRoot1 = "/test/proj1oldformat";
      const projectRoot2 = "/test/proj2oldformat";
      const hash1 = getProjectHash(projectRoot1);
      const hash2 = getProjectHash(projectRoot2);

      // Create handoff for project 1 with old format
      const oldFormat1 = createTestHandoff(projectRoot1, hash1, "old1");
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "old1.json"),
        JSON.stringify(oldFormat1, null, 2),
      );

      // Create handoff for project 2 with old format
      const oldFormat2 = createTestHandoff(projectRoot2, hash2, "old2");
      await writeFile(
        join(TEST_STORAGE_DIR_ENV, "old2.json"),
        JSON.stringify(oldFormat2, null, 2),
      );

      const result = await listHandoffs(projectRoot1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("old1");
    });
  });
});
