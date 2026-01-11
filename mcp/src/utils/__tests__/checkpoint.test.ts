import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProjectHash,
  getStorageDir,
  getCheckpointPath,
  getOrCreateCheckpoint,
  updateCheckpointTimestamp,
  ensureStorageDir,
} from "../checkpoint.js";

const TEST_STORAGE_BASE = join(tmpdir(), "session-context-test");

describe("checkpoint utilities", () => {
  beforeEach(async () => {
    // Clean test directory
    await rm(TEST_STORAGE_BASE, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_STORAGE_BASE, { recursive: true, force: true });
  });

  describe("getProjectHash", () => {
    test("generates consistent 8-character hash for project path", () => {
      const path1 = "/path/to/project";
      const hash1 = getProjectHash(path1);
      const hash2 = getProjectHash(path1);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
      expect(hash1).toMatch(/^[a-f0-9]{8}$/);
    });

    test("generates different hashes for different paths", () => {
      const hash1 = getProjectHash("/path/to/project1");
      const hash2 = getProjectHash("/path/to/project2");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getStorageDir", () => {
    test("returns path under .claude/session-context/handoffs", () => {
      const dir = getStorageDir();
      expect(dir).toContain(".claude");
      expect(dir).toContain("session-context");
      expect(dir).toContain("handoffs");
    });

    test("accepts custom base directory", () => {
      const customBase = "/custom/base";
      const dir = getStorageDir(customBase);
      expect(dir).toBe(join(customBase, ".claude", "session-context", "handoffs"));
    });
  });

  describe("getCheckpointPath", () => {
    test("returns path with project hash and -current suffix", () => {
      const projectRoot = "/my/project";
      const hash = getProjectHash(projectRoot);
      const path = getCheckpointPath(projectRoot, TEST_STORAGE_BASE);

      expect(path).toContain(`${hash}-current.json`);
      expect(path).toContain(".claude");
    });
  });

  describe("ensureStorageDir", () => {
    test("creates storage directory if it doesn't exist", async () => {
      const dir = join(TEST_STORAGE_BASE, ".claude", "session-context", "handoffs");
      await ensureStorageDir(TEST_STORAGE_BASE);

      const stat = await Bun.file(dir).stat();
      expect(stat?.isDirectory()).toBe(true);
    });

    test("does not fail if directory already exists", async () => {
      const dir = join(TEST_STORAGE_BASE, ".claude", "session-context", "handoffs");
      await mkdir(dir, { recursive: true });

      await expect(ensureStorageDir(TEST_STORAGE_BASE)).resolves.toBeUndefined();
    });
  });

  describe("getOrCreateCheckpoint", () => {
    test("creates new checkpoint if none exists", async () => {
      const projectRoot = "/test/project";
      const branch = "main";

      const checkpoint = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);

      expect(checkpoint).toMatchObject({
        version: 1,
        ttl: "24h",
        project: {
          root: projectRoot,
          branch,
        },
        context: {
          task: "Working on project",
          state: "in_progress",
          files: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
          userDecisions: [],
        },
        todos: [],
        references: {},
      });

      expect(checkpoint.id).toMatch(/^[a-z0-9]{5}$/);
      expect(checkpoint.project.hash).toHaveLength(8);
      expect(checkpoint.created).toBeTruthy();
      expect(checkpoint.updated).toBeTruthy();
    });

    test("returns existing checkpoint if found", async () => {
      const projectRoot = "/test/project";
      const branch = "main";

      const first = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);
      const second = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);

      expect(second.id).toBe(first.id);
      expect(second.created).toBe(first.created);
    });

    test("preserves existing checkpoint data", async () => {
      const projectRoot = "/test/project";
      const branch = "main";

      const checkpoint = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);
      checkpoint.context.task = "Custom task";
      checkpoint.todos = [{ content: "Test todo", status: "pending", activeForm: "Testing todo" }];

      const checkpointPath = getCheckpointPath(projectRoot, TEST_STORAGE_BASE);
      await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

      const reloaded = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);

      expect(reloaded.context.task).toBe("Custom task");
      expect(reloaded.todos).toHaveLength(1);
    });

    test("updates branch on existing checkpoint", async () => {
      const projectRoot = "/test/project";

      await getOrCreateCheckpoint(projectRoot, "main", TEST_STORAGE_BASE);
      const updated = await getOrCreateCheckpoint(projectRoot, "feature/test", TEST_STORAGE_BASE);

      expect(updated.project.branch).toBe("feature/test");
    });
  });

  describe("updateCheckpointTimestamp", () => {
    test("updates the timestamp on existing checkpoint", async () => {
      const projectRoot = "/test/project";
      const branch = "main";

      const original = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);
      const originalTime = original.updated;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await updateCheckpointTimestamp(projectRoot, TEST_STORAGE_BASE);

      const updated = await getOrCreateCheckpoint(projectRoot, branch, TEST_STORAGE_BASE);

      expect(updated.updated).not.toBe(originalTime);
      expect(new Date(updated.updated).getTime()).toBeGreaterThan(
        new Date(originalTime).getTime()
      );
    });

    test("creates checkpoint if none exists", async () => {
      const projectRoot = "/test/project";

      await updateCheckpointTimestamp(projectRoot, TEST_STORAGE_BASE);

      const checkpoint = await getOrCreateCheckpoint(projectRoot, "main", TEST_STORAGE_BASE);

      expect(checkpoint).toBeTruthy();
      expect(checkpoint.updated).toBeTruthy();
    });
  });
});
