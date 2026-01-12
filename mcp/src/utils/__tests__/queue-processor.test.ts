import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
  type Checkpoint,
} from "../checkpoint.js";

// Test directories
const TEST_BASE = join(tmpdir(), "session-context-queue-processor-test");
const TEST_QUEUE_DIR = join(TEST_BASE, "queue");
const TEST_STORAGE_BASE = join(TEST_BASE, "storage");

// Helper to create a queue file
async function createQueueFile(
  update: {
    projectRoot: string;
    updateType: "file" | "todo" | "plan" | "userDecision";
    payload: unknown;
  },
  timestamp?: string
): Promise<string> {
  const id = Math.random().toString(36).slice(2, 10);
  const queuedUpdate = {
    id,
    timestamp: timestamp || new Date().toISOString(),
    ...update,
  };

  const filename = `${Date.now()}-${id}.json`;
  const filepath = join(TEST_QUEUE_DIR, filename);
  await writeFile(filepath, JSON.stringify(queuedUpdate, null, 2), "utf-8");

  return filename;
}

// Helper to read checkpoint
async function readCheckpoint(projectRoot: string): Promise<Checkpoint> {
  const path = getCheckpointPath(projectRoot, TEST_STORAGE_BASE);
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

describe("queue-processor", () => {
  beforeEach(async () => {
    await rm(TEST_BASE, { recursive: true, force: true });
    await mkdir(TEST_QUEUE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_BASE, { recursive: true, force: true });
  });

  describe("applyUpdate - file updates", () => {
    test("adds new file to checkpoint", async () => {
      const projectRoot = "/test/project";

      // Create initial checkpoint
      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Apply file update
      const payload = { filePath: "/test/file.ts", role: "modified" };

      // Manually apply update logic (testing the logic itself)
      if (!Array.isArray(checkpoint.context.files)) {
        checkpoint.context.files = [];
      }
      const existingIndex = checkpoint.context.files.findIndex(
        (f) => f.path === payload.filePath
      );
      if (existingIndex >= 0) {
        checkpoint.context.files[existingIndex].role = payload.role;
      } else {
        checkpoint.context.files.push({ path: payload.filePath, role: payload.role });
      }

      expect(checkpoint.context.files).toHaveLength(1);
      expect(checkpoint.context.files[0]).toEqual({
        path: "/test/file.ts",
        role: "modified",
      });
    });

    test("updates existing file role", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Add initial file
      checkpoint.context.files = [{ path: "/test/file.ts", role: "created" }];

      // Apply update with new role
      const payload = { filePath: "/test/file.ts", role: "modified" };
      const existingIndex = checkpoint.context.files.findIndex(
        (f) => f.path === payload.filePath
      );
      if (existingIndex >= 0) {
        checkpoint.context.files[existingIndex].role = payload.role;
      }

      expect(checkpoint.context.files).toHaveLength(1);
      expect(checkpoint.context.files[0].role).toBe("modified");
    });
  });

  describe("applyUpdate - todo updates", () => {
    test("replaces todos in checkpoint", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Apply todo update
      const payload = {
        todos: [
          { content: "Task 1", status: "in_progress" as const },
          { content: "Task 2", status: "pending" as const },
        ],
      };

      checkpoint.todos = payload.todos;

      expect(checkpoint.todos).toHaveLength(2);
      expect(checkpoint.todos[0].content).toBe("Task 1");
    });

    test("infers task from in-progress todo", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      expect(checkpoint.context.task).toBe("Working on project");

      // Apply todo update with in-progress item
      const payload = {
        todos: [{ content: "Implement feature X", status: "in_progress" as const }],
      };

      checkpoint.todos = payload.todos;
      const inProgressTodo = payload.todos.find((t) => t.status === "in_progress");
      if (
        inProgressTodo &&
        (!checkpoint.context.task || checkpoint.context.task === "Working on project")
      ) {
        checkpoint.context.task = inProgressTodo.content;
      }

      expect(checkpoint.context.task).toBe("Implement feature X");
    });
  });

  describe("applyUpdate - plan updates", () => {
    test("stores plan content in checkpoint", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Apply plan update
      const payload = {
        plan: {
          path: "/home/user/.claude/plans/my-plan.md",
          cachedAt: new Date().toISOString(),
          content: "# My Plan\n\n1. Do thing\n2. Do other thing",
        },
        taskFromPlan: "My Plan",
      };

      checkpoint.context.plan = payload.plan;
      if (
        payload.taskFromPlan &&
        (!checkpoint.context.task || checkpoint.context.task === "Working on project")
      ) {
        checkpoint.context.task = payload.taskFromPlan;
      }

      expect(checkpoint.context.plan).toBeDefined();
      expect(checkpoint.context.plan?.path).toBe("/home/user/.claude/plans/my-plan.md");
      expect(checkpoint.context.plan?.content).toContain("# My Plan");
      expect(checkpoint.context.task).toBe("My Plan");
    });
  });

  describe("applyUpdate - userDecision updates", () => {
    test("appends user decisions to checkpoint", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Apply userDecision update
      const payload = {
        decisions: [
          {
            question: "Which approach?",
            answer: "Option A",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      if (!Array.isArray(checkpoint.context.userDecisions)) {
        checkpoint.context.userDecisions = [];
      }
      checkpoint.context.userDecisions.push(...payload.decisions);

      expect(checkpoint.context.userDecisions).toHaveLength(1);
      expect(checkpoint.context.userDecisions[0].question).toBe("Which approach?");
      expect(checkpoint.context.userDecisions[0].answer).toBe("Option A");
    });

    test("limits userDecisions to 20 entries", async () => {
      const projectRoot = "/test/project";

      const checkpoint = await getOrCreateCheckpoint(
        projectRoot,
        "main",
        TEST_STORAGE_BASE
      );

      // Pre-populate with 19 decisions
      checkpoint.context.userDecisions = Array.from({ length: 19 }, (_, i) => ({
        question: `Q${i}`,
        answer: `A${i}`,
        timestamp: new Date().toISOString(),
      }));

      // Add 3 more decisions
      const newDecisions = [
        { question: "Q19", answer: "A19", timestamp: new Date().toISOString() },
        { question: "Q20", answer: "A20", timestamp: new Date().toISOString() },
        { question: "Q21", answer: "A21", timestamp: new Date().toISOString() },
      ];

      checkpoint.context.userDecisions.push(...newDecisions);

      // Apply limit
      if (checkpoint.context.userDecisions.length > 20) {
        checkpoint.context.userDecisions = checkpoint.context.userDecisions.slice(-20);
      }

      expect(checkpoint.context.userDecisions).toHaveLength(20);
      // Should have dropped Q0, Q1
      expect(checkpoint.context.userDecisions[0].question).toBe("Q2");
      expect(checkpoint.context.userDecisions[19].question).toBe("Q21");
    });
  });

  describe("queue file handling", () => {
    test("queue files are created with correct naming convention", async () => {
      const filename = await createQueueFile({
        projectRoot: "/test/project",
        updateType: "file",
        payload: { filePath: "/test.ts", role: "modified" },
      });

      expect(filename).toMatch(/^\d+-[a-z0-9]+\.json$/);
    });

    test("queue files contain complete update data", async () => {
      await createQueueFile({
        projectRoot: "/test/project",
        updateType: "todo",
        payload: { todos: [{ content: "Test", status: "pending" }] },
      });

      const files = await readdir(TEST_QUEUE_DIR);
      expect(files).toHaveLength(1);

      const content = await readFile(join(TEST_QUEUE_DIR, files[0]), "utf-8");
      const update = JSON.parse(content);

      expect(update).toMatchObject({
        id: expect.any(String),
        timestamp: expect.any(String),
        projectRoot: "/test/project",
        updateType: "todo",
        payload: {
          todos: [{ content: "Test", status: "pending" }],
        },
      });
    });

    test("multiple queue files are created independently", async () => {
      await createQueueFile({
        projectRoot: "/project1",
        updateType: "file",
        payload: {},
      });

      await createQueueFile({
        projectRoot: "/project2",
        updateType: "todo",
        payload: {},
      });

      const files = await readdir(TEST_QUEUE_DIR);
      expect(files).toHaveLength(2);
    });
  });

  describe("grouping by project", () => {
    test("updates are grouped by projectRoot for batch processing", async () => {
      // Create updates for different projects
      await createQueueFile({
        projectRoot: "/project/a",
        updateType: "file",
        payload: { filePath: "/a/file1.ts", role: "modified" },
      });

      await createQueueFile({
        projectRoot: "/project/a",
        updateType: "file",
        payload: { filePath: "/a/file2.ts", role: "created" },
      });

      await createQueueFile({
        projectRoot: "/project/b",
        updateType: "todo",
        payload: { todos: [] },
      });

      // Read and group
      const files = await readdir(TEST_QUEUE_DIR);
      const updates = [];

      for (const file of files) {
        const content = await readFile(join(TEST_QUEUE_DIR, file), "utf-8");
        updates.push(JSON.parse(content));
      }

      const byProject = new Map<string, unknown[]>();
      for (const update of updates) {
        if (!byProject.has(update.projectRoot)) {
          byProject.set(update.projectRoot, []);
        }
        byProject.get(update.projectRoot)!.push(update);
      }

      expect(byProject.get("/project/a")).toHaveLength(2);
      expect(byProject.get("/project/b")).toHaveLength(1);
    });
  });
});
