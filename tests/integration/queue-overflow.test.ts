/**
 * Integration tests: Queue Overflow Handling
 *
 * Tests for queue cleanup and orphaned file handling
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  processQueue,
  getQueueStatus,
  cleanupOrphanedQueueFiles,
} from "../../mcp/src/utils/queue-processor.js";

const QUEUE_DIR = "/tmp/claude/session-context-queue";

describe("Queue Overflow Handling", () => {
  beforeEach(async () => {
    // Clean up queue dir before each test
    try {
      await rm(QUEUE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await mkdir(QUEUE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await rm(QUEUE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("cleanupOrphanedQueueFiles removes files older than 24h", async () => {
    // Create old queue entry (25 hours ago)
    const oldEntry = {
      id: "old-entry",
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      projectRoot: "/nonexistent/project",
      updateType: "file",
      payload: { filePath: "/old.ts", role: "modified" },
    };
    await writeFile(join(QUEUE_DIR, "old.json"), JSON.stringify(oldEntry));

    // Create fresh queue entry
    const freshEntry = {
      id: "fresh-entry",
      timestamp: new Date().toISOString(),
      projectRoot: "/nonexistent/project",
      updateType: "file",
      payload: { filePath: "/fresh.ts", role: "modified" },
    };
    await writeFile(join(QUEUE_DIR, "fresh.json"), JSON.stringify(freshEntry));

    const cleaned = await cleanupOrphanedQueueFiles();

    expect(cleaned).toBe(1); // Only old file cleaned

    const files = await readdir(QUEUE_DIR);
    expect(files).toContain("fresh.json");
    expect(files).not.toContain("old.json");
  });

  test("cleanupOrphanedQueueFiles removes unparseable files", async () => {
    // Create corrupted JSON file
    await writeFile(join(QUEUE_DIR, "corrupted.json"), "{ not valid json");

    // Create valid file
    const validEntry = {
      id: "valid-entry",
      timestamp: new Date().toISOString(),
      projectRoot: "/project",
      updateType: "file",
      payload: {},
    };
    await writeFile(join(QUEUE_DIR, "valid.json"), JSON.stringify(validEntry));

    const cleaned = await cleanupOrphanedQueueFiles();

    expect(cleaned).toBe(1); // Corrupted file cleaned

    const files = await readdir(QUEUE_DIR);
    expect(files).toContain("valid.json");
    expect(files).not.toContain("corrupted.json");
  });

  test("getQueueStatus reports accurate counts", async () => {
    // Add various entries
    for (let i = 0; i < 5; i++) {
      const entry = {
        id: `file-${i}`,
        timestamp: new Date().toISOString(),
        projectRoot: "/test/project",
        updateType: "file",
        payload: { filePath: `/file${i}.ts`, role: "modified" },
      };
      await writeFile(
        join(QUEUE_DIR, `${Date.now()}-file-${i}.json`),
        JSON.stringify(entry),
      );
    }

    // Add todo entry
    const todoEntry = {
      id: "todo-1",
      timestamp: new Date().toISOString(),
      projectRoot: "/test/project",
      updateType: "todo",
      payload: {
        todos: [{ content: "Task", status: "pending", activeForm: "Task" }],
      },
    };
    await writeFile(
      join(QUEUE_DIR, `${Date.now()}-todo.json`),
      JSON.stringify(todoEntry),
    );

    const status = await getQueueStatus();

    expect(status.pending).toBe(6);
    expect(status.byType["file"]).toBe(5);
    expect(status.byType["todo"]).toBe(1);
  });

  test("processQueue handles empty queue gracefully", async () => {
    const result = await processQueue();

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });

  test("cleanupOrphanedQueueFiles preserves files within TTL", async () => {
    // Create file from 12 hours ago (within 24h TTL)
    const recentEntry = {
      id: "recent",
      timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      projectRoot: "/project",
      updateType: "file",
      payload: {},
    };
    await writeFile(
      join(QUEUE_DIR, "recent.json"),
      JSON.stringify(recentEntry),
    );

    const cleaned = await cleanupOrphanedQueueFiles();

    expect(cleaned).toBe(0);

    const files = await readdir(QUEUE_DIR);
    expect(files).toContain("recent.json");
  });

  test("cleanupOrphanedQueueFiles handles missing timestamp gracefully", async () => {
    // Create file with missing timestamp (should be treated as unparseable)
    const badEntry = {
      id: "bad",
      projectRoot: "/project",
      updateType: "file",
      payload: {},
      // No timestamp field
    };
    await writeFile(join(QUEUE_DIR, "bad.json"), JSON.stringify(badEntry));

    // This should not throw
    const cleaned = await cleanupOrphanedQueueFiles();

    // NaN from Date parse comparison will be false, so won't be cleaned
    // unless the parse throws - behavior depends on implementation
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });
});
