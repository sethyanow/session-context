/**
 * Integration tests: Queue -> MCP Processing
 *
 * Tests that the MCP server correctly processes queued updates
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  processQueue,
  getQueueStatus,
  hasQueuedUpdates,
} from "../../mcp/src/utils/queue-processor.js";
import { getRollingCheckpoint } from "../../mcp/src/storage/handoffs.js";
import { expectQueueEmpty } from "../utils/assertions.js";

const QUEUE_DIR = "/tmp/claude/session-context-queue";

describe("Queue -> MCP Processing", () => {
  let testProjectRoot: string;
  let testHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    // Create isolated test environment
    const testId = `queue-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testProjectRoot = join(tmpdir(), testId, "project");
    testHome = join(tmpdir(), testId, "home");

    await mkdir(testProjectRoot, { recursive: true });
    await mkdir(join(testHome, ".claude", "session-context", "handoffs"), {
      recursive: true,
    });
    await mkdir(QUEUE_DIR, { recursive: true });

    // Init git repo
    const { spawn } = await import("bun");
    await spawn(["git", "init"], {
      cwd: testProjectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    await spawn(["git", "config", "user.email", "test@test.com"], {
      cwd: testProjectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    await spawn(["git", "config", "user.name", "Test"], {
      cwd: testProjectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;

    process.env.HOME = testHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;

    try {
      // Clean up test directories
      const testDir = join(tmpdir(), testProjectRoot.split("/")[3]);
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("processQueue applies file updates to checkpoint", async () => {
    const now = Date.now();

    // Manually write a queue entry
    const queueEntry = {
      id: `test-${now}`,
      timestamp: new Date().toISOString(),
      projectRoot: testProjectRoot,
      updateType: "file",
      payload: { filePath: "/test/file.ts", role: "modified" },
    };

    await writeFile(
      join(QUEUE_DIR, `${now}-file.json`),
      JSON.stringify(queueEntry)
    );

    // Process the queue
    const result = await processQueue();

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    // Verify checkpoint has the file
    const checkpoint = await getRollingCheckpoint(testProjectRoot);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.context.files.some((f) => f.path === "/test/file.ts")).toBe(true);
  });

  test("processQueue handles todo updates", async () => {
    const now = Date.now();

    const queueEntry = {
      id: `test-${now}`,
      timestamp: new Date().toISOString(),
      projectRoot: testProjectRoot,
      updateType: "todo",
      payload: {
        todos: [
          { content: "Task 1", status: "in_progress", activeForm: "Working" },
          { content: "Task 2", status: "pending", activeForm: "Pending" },
        ],
      },
    };

    await writeFile(
      join(QUEUE_DIR, `${now}-todo.json`),
      JSON.stringify(queueEntry)
    );

    const result = await processQueue();

    expect(result.processed).toBeGreaterThanOrEqual(1);

    const checkpoint = await getRollingCheckpoint(testProjectRoot);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.todos).toHaveLength(2);
  });

  test("processQueue handles multiple update types", async () => {
    const now = Date.now();

    // Queue file update
    await writeFile(
      join(QUEUE_DIR, `${now}-file.json`),
      JSON.stringify({
        id: "file1",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "file",
        payload: { filePath: "/test/a.ts", role: "created" },
      })
    );

    // Queue todo update
    await writeFile(
      join(QUEUE_DIR, `${now + 1}-todo.json`),
      JSON.stringify({
        id: "todo1",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "todo",
        payload: {
          todos: [{ content: "Task", status: "pending", activeForm: "Task" }],
        },
      })
    );

    const result = await processQueue();

    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
  });

  test("getQueueStatus reports pending updates by type", async () => {
    const now = Date.now();

    await writeFile(
      join(QUEUE_DIR, `${now}-status1.json`),
      JSON.stringify({
        id: "s1",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "file",
        payload: {},
      })
    );

    await writeFile(
      join(QUEUE_DIR, `${now + 1}-status2.json`),
      JSON.stringify({
        id: "s2",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "todo",
        payload: {},
      })
    );

    const status = await getQueueStatus();

    expect(status.pending).toBe(2);
    expect(status.byType.file).toBe(1);
    expect(status.byType.todo).toBe(1);
  });

  test("hasQueuedUpdates returns correct status", async () => {
    // Initially should be empty
    const initialStatus = await hasQueuedUpdates();

    // Add an entry
    const now = Date.now();
    await writeFile(
      join(QUEUE_DIR, `${now}-check.json`),
      JSON.stringify({
        id: "check",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "file",
        payload: {},
      })
    );

    const afterAdd = await hasQueuedUpdates();
    expect(afterAdd).toBe(true);

    // Process and check again
    await processQueue();
    await expectQueueEmpty(QUEUE_DIR);
  });

  test("processQueue removes files after successful processing", async () => {
    const now = Date.now();

    await writeFile(
      join(QUEUE_DIR, `${now}-remove.json`),
      JSON.stringify({
        id: "remove",
        timestamp: new Date().toISOString(),
        projectRoot: testProjectRoot,
        updateType: "file",
        payload: { filePath: "/test/remove.ts", role: "modified" },
      })
    );

    await processQueue();

    // Queue should be empty after processing
    await expectQueueEmpty(QUEUE_DIR);
  });
});
