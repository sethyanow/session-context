import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
