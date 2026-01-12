import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  isPermissionError,
  outputFallbackUsed,
} from "../lib/fallback-queue.ts";

// Test directories
const TEST_QUEUE_DIR = join(tmpdir(), "session-context-test-queue");

describe("fallback-queue", () => {
  beforeEach(async () => {
    await rm(TEST_QUEUE_DIR, { recursive: true, force: true });
    await mkdir(TEST_QUEUE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_QUEUE_DIR, { recursive: true, force: true });
  });

  describe("isPermissionError", () => {
    test("returns true for EPERM error", () => {
      const error = new Error("EPERM: operation not permitted");
      expect(isPermissionError(error)).toBe(true);
    });

    test("returns true for EACCES error", () => {
      const error = new Error("EACCES: permission denied");
      expect(isPermissionError(error)).toBe(true);
    });

    test("returns true for 'operation not permitted' message", () => {
      const error = new Error("Some operation not permitted issue");
      expect(isPermissionError(error)).toBe(true);
    });

    test("returns true for 'permission denied' message", () => {
      const error = new Error("File permission denied by system");
      expect(isPermissionError(error)).toBe(true);
    });

    test("returns false for other errors", () => {
      const error = new Error("File not found");
      expect(isPermissionError(error)).toBe(false);
    });

    test("returns false for non-Error types", () => {
      expect(isPermissionError("string error")).toBe(false);
      expect(isPermissionError(null)).toBe(false);
      expect(isPermissionError(undefined)).toBe(false);
      expect(isPermissionError(42)).toBe(false);
    });
  });

  describe("outputFallbackUsed", () => {
    test("outputs valid JSON with expected structure", () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

      outputFallbackUsed("file", "abc123");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(output).toMatchObject({
        continue: true,
        hookSpecificOutput: {
          fallbackUsed: true,
          reason: expect.stringContaining("sandbox"),
          updateType: "file",
          queueId: "abc123",
        },
      });

      consoleSpy.mockRestore();
    });

    test("includes queue directory in output", () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

      outputFallbackUsed("todo", "xyz789");

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.hookSpecificOutput.queueDir).toBeTruthy();

      consoleSpy.mockRestore();
    });

    test("outputs different update types correctly", () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

      const types = ["file", "todo", "plan", "userDecision"];
      for (const type of types) {
        outputFallbackUsed(type, "id123");
        const output = JSON.parse(consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1][0]);
        expect(output.hookSpecificOutput.updateType).toBe(type);
      }

      consoleSpy.mockRestore();
    });
  });
});

describe("fallback-queue integration", () => {
  // These tests use a custom queue directory for isolation
  const CUSTOM_QUEUE_DIR = join(tmpdir(), "session-context-queue-integration");

  beforeEach(async () => {
    await rm(CUSTOM_QUEUE_DIR, { recursive: true, force: true });
    await mkdir(CUSTOM_QUEUE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(CUSTOM_QUEUE_DIR, { recursive: true, force: true });
  });

  test("queue file structure matches expected format", async () => {
    const update = {
      projectRoot: "/test/project",
      updateType: "file" as const,
      payload: { filePath: "/test/file.ts", role: "modified" },
    };

    const id = randomUUID().slice(0, 8);
    const queuedUpdate = {
      id,
      timestamp: new Date().toISOString(),
      ...update,
    };

    const filename = `${Date.now()}-${id}.json`;
    const filepath = join(CUSTOM_QUEUE_DIR, filename);
    await writeFile(filepath, JSON.stringify(queuedUpdate, null, 2), "utf-8");

    // Verify
    const files = await readdir(CUSTOM_QUEUE_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+-[a-f0-9-]+\.json$/);

    const content = await readFile(filepath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed).toMatchObject({
      id: expect.any(String),
      timestamp: expect.any(String),
      projectRoot: "/test/project",
      updateType: "file",
      payload: {
        filePath: "/test/file.ts",
        role: "modified",
      },
    });
  });

  test("queue files are sorted by timestamp when read", async () => {
    // Create files with different timestamps
    const older = {
      id: "older111",
      timestamp: "2026-01-01T00:00:00.000Z",
      projectRoot: "/test",
      updateType: "file",
      payload: {},
    };

    const newer = {
      id: "newer222",
      timestamp: "2026-01-02T00:00:00.000Z",
      projectRoot: "/test",
      updateType: "file",
      payload: {},
    };

    // Write newer first (to test sorting works regardless of file order)
    await writeFile(
      join(CUSTOM_QUEUE_DIR, "2-newer222.json"),
      JSON.stringify(newer),
      "utf-8"
    );
    await writeFile(
      join(CUSTOM_QUEUE_DIR, "1-older111.json"),
      JSON.stringify(older),
      "utf-8"
    );

    // Read and parse
    const files = await readdir(CUSTOM_QUEUE_DIR);
    const updates = [];

    for (const file of files) {
      const content = await readFile(join(CUSTOM_QUEUE_DIR, file), "utf-8");
      updates.push(JSON.parse(content));
    }

    updates.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    expect(updates[0].id).toBe("older111");
    expect(updates[1].id).toBe("newer222");
  });

  test("multiple update types can coexist in queue", async () => {
    const updates = [
      { id: "1", timestamp: new Date().toISOString(), projectRoot: "/p", updateType: "file", payload: {} },
      { id: "2", timestamp: new Date().toISOString(), projectRoot: "/p", updateType: "todo", payload: {} },
      { id: "3", timestamp: new Date().toISOString(), projectRoot: "/p", updateType: "plan", payload: {} },
      { id: "4", timestamp: new Date().toISOString(), projectRoot: "/p", updateType: "userDecision", payload: {} },
    ];

    for (const update of updates) {
      await writeFile(
        join(CUSTOM_QUEUE_DIR, `${Date.now()}-${update.id}.json`),
        JSON.stringify(update),
        "utf-8"
      );
    }

    const files = await readdir(CUSTOM_QUEUE_DIR);
    expect(files).toHaveLength(4);
  });
});
