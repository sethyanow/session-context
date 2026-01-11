import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const execAsync = promisify(exec);

export interface CheckpointFile {
  path: string;
  role: string;
}

export interface CheckpointUserDecision {
  question: string;
  answer: string;
  timestamp: string;
}

export interface CheckpointTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface CheckpointPlan {
  path: string;
  cachedAt: string;
  content: string;
}

export interface Checkpoint {
  id: string;
  version: number;
  created: string;
  updated: string;
  ttl: string;
  project: {
    root: string;
    hash: string;
    branch: string;
  };
  context: {
    task: string;
    summary: string;
    state: string;
    files: CheckpointFile[];
    decisions: string[];
    blockers: string[];
    nextSteps: string[];
    userDecisions: CheckpointUserDecision[];
    plan?: CheckpointPlan;
  };
  todos: CheckpointTodo[];
  references: Record<string, unknown>;
}

/**
 * Generate a consistent 8-character hash from a project path
 */
export function getProjectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
}

/**
 * Get the storage directory path for session context handoffs
 * @param baseDir - Optional base directory (defaults to user's home directory)
 */
export function getStorageDir(baseDir?: string): string {
  const base = baseDir || homedir();
  return join(base, ".claude", "session-context", "handoffs");
}

/**
 * Get the checkpoint file path for a project
 * @param projectRoot - Absolute path to the project root
 * @param baseDir - Optional base directory for storage
 */
export function getCheckpointPath(projectRoot: string, baseDir?: string): string {
  const hash = getProjectHash(projectRoot);
  const storageDir = getStorageDir(baseDir);
  return join(storageDir, `${hash}-current.json`);
}

/**
 * Ensure the storage directory exists
 * @param baseDir - Optional base directory for storage
 */
export async function ensureStorageDir(baseDir?: string): Promise<void> {
  const storageDir = getStorageDir(baseDir);
  await mkdir(storageDir, { recursive: true });
}

/**
 * Generate a random 5-character checkpoint ID
 */
function generateCheckpointId(): string {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Get the current git branch for a project
 * @param projectRoot - Absolute path to the project root
 * @returns The current branch name or "main" if not in a git repo
 */
async function getCurrentBranch(projectRoot: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git branch --show-current", { cwd: projectRoot });
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}

/**
 * Create a new checkpoint with default values
 */
function createDefaultCheckpoint(projectRoot: string, branch: string): Checkpoint {
  const now = new Date().toISOString();
  const hash = getProjectHash(projectRoot);

  return {
    id: generateCheckpointId(),
    version: 1,
    created: now,
    updated: now,
    ttl: "24h",
    project: {
      root: projectRoot,
      hash,
      branch,
    },
    context: {
      task: "Working on project",
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
}

/**
 * Get an existing checkpoint or create a new one
 * @param projectRoot - Absolute path to the project root
 * @param branch - Current git branch (optional, will be detected if not provided)
 * @param baseDir - Optional base directory for storage
 */
export async function getOrCreateCheckpoint(
  projectRoot: string,
  branch?: string,
  baseDir?: string
): Promise<Checkpoint> {
  await ensureStorageDir(baseDir);

  const checkpointPath = getCheckpointPath(projectRoot, baseDir);
  const currentBranch = branch || (await getCurrentBranch(projectRoot));

  // Try to read existing checkpoint
  try {
    const content = await readFile(checkpointPath, "utf-8");
    const checkpoint = JSON.parse(content) as Checkpoint;

    // Update branch if it changed
    if (checkpoint.project.branch !== currentBranch) {
      checkpoint.project.branch = currentBranch;
      checkpoint.updated = new Date().toISOString();
      await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");
    }

    return checkpoint;
  } catch {
    // Create new checkpoint
    const checkpoint = createDefaultCheckpoint(projectRoot, currentBranch);
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");
    return checkpoint;
  }
}

/**
 * Update the timestamp on an existing checkpoint (or create if missing)
 * @param projectRoot - Absolute path to the project root
 * @param baseDir - Optional base directory for storage
 */
export async function updateCheckpointTimestamp(
  projectRoot: string,
  baseDir?: string
): Promise<void> {
  const checkpoint = await getOrCreateCheckpoint(projectRoot, undefined, baseDir);
  checkpoint.updated = new Date().toISOString();

  const checkpointPath = getCheckpointPath(projectRoot, baseDir);
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

/**
 * Update a checkpoint with new data
 * @param projectRoot - Absolute path to the project root
 * @param updates - Partial checkpoint data to merge
 * @param baseDir - Optional base directory for storage
 */
export async function updateCheckpoint(
  projectRoot: string,
  updates: Partial<Checkpoint>,
  baseDir?: string
): Promise<Checkpoint> {
  const checkpoint = await getOrCreateCheckpoint(projectRoot, undefined, baseDir);

  // Deep merge updates
  Object.assign(checkpoint, updates);
  checkpoint.updated = new Date().toISOString();

  const checkpointPath = getCheckpointPath(projectRoot, baseDir);
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  return checkpoint;
}
