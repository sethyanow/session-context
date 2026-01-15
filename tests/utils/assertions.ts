/**
 * Custom assertions for session-context integration tests
 */
import { expect } from "bun:test";
import { readdir } from "node:fs/promises";
import type { Handoff } from "../../mcp/src/types.js";

/**
 * Assert that a checkpoint contains expected files
 */
export function expectFilesTracked(
  handoff: Handoff | null,
  expectedPaths: string[]
): void {
  expect(handoff).not.toBeNull();

  const actualPaths = handoff!.context.files.map((f) => f.path);

  for (const path of expectedPaths) {
    const found = actualPaths.some(
      (p) => p.includes(path) || path.includes(p)
    );
    expect(found).toBe(true);
  }
}

/**
 * Assert that a checkpoint has todos in expected state
 */
export function expectTodoState(
  handoff: Handoff | null,
  expectedCounts: {
    pending?: number;
    in_progress?: number;
    completed?: number;
  }
): void {
  expect(handoff).not.toBeNull();

  const todos = handoff!.todos;

  if (expectedCounts.pending !== undefined) {
    const pending = todos.filter((t) => t.status === "pending").length;
    expect(pending).toBe(expectedCounts.pending);
  }

  if (expectedCounts.in_progress !== undefined) {
    const inProgress = todos.filter((t) => t.status === "in_progress").length;
    expect(inProgress).toBe(expectedCounts.in_progress);
  }

  if (expectedCounts.completed !== undefined) {
    const completed = todos.filter((t) => t.status === "completed").length;
    expect(completed).toBe(expectedCounts.completed);
  }
}

/**
 * Assert that queue is empty (all updates processed)
 */
export async function expectQueueEmpty(queueDir: string): Promise<void> {
  try {
    const files = await readdir(queueDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBe(0);
  } catch {
    // Directory doesn't exist = empty, which is fine
  }
}

/**
 * Assert that queue has expected number of pending updates
 */
export async function expectQueuePending(
  queueDir: string,
  expectedCount: number
): Promise<void> {
  try {
    const files = await readdir(queueDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBe(expectedCount);
  } catch {
    if (expectedCount === 0) {
      // Directory doesn't exist = empty, which is expected
      return;
    }
    throw new Error(`Queue directory does not exist but expected ${expectedCount} items`);
  }
}

/**
 * Assert handoff contains user decisions
 */
export function expectUserDecisions(
  handoff: Handoff | null,
  minCount: number
): void {
  expect(handoff).not.toBeNull();
  expect(handoff!.context.userDecisions.length).toBeGreaterThanOrEqual(
    minCount
  );
}

/**
 * Assert handoff has a plan cached
 */
export function expectPlanCached(
  handoff: Handoff | null,
  pathContains?: string
): void {
  expect(handoff).not.toBeNull();
  expect(handoff!.context.plan).toBeDefined();

  if (pathContains) {
    expect(handoff!.context.plan?.path).toContain(pathContains);
  }
}

/**
 * Assert handoff has expected project info
 */
export function expectProjectInfo(
  handoff: Handoff | null,
  expected: { branch?: string; hash?: string }
): void {
  expect(handoff).not.toBeNull();

  if (expected.branch !== undefined) {
    expect(handoff!.project.branch).toBe(expected.branch);
  }

  if (expected.hash !== undefined) {
    expect(handoff!.project.hash).toBe(expected.hash);
  }
}
