import { readFile, writeFile, mkdir, readdir, unlink, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { Handoff, SessionContextConfig } from "../types.js";

const STORAGE_DIR = join(homedir(), ".claude", "session-context", "handoffs");
const CONFIG_PATH = join(homedir(), ".claude", "session-context", "config.json");

// Generate short handoff ID
export function generateHandoffId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Generate project hash from path
export function getProjectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
}

// Ensure storage directory exists
async function ensureStorageDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

// Get rolling checkpoint path for a project
function getRollingCheckpointPath(projectHash: string): string {
  return join(STORAGE_DIR, `${projectHash}-current.json`);
}

// Get explicit handoff path
function getHandoffPath(handoffId: string): string {
  return join(STORAGE_DIR, `${handoffId}.json`);
}

// Read a handoff by ID or project hash (for rolling)
export async function readHandoff(idOrHash: string, isRolling = false): Promise<Handoff | null> {
  try {
    const path = isRolling
      ? getRollingCheckpointPath(idOrHash)
      : getHandoffPath(idOrHash);
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as Handoff;
  } catch {
    return null;
  }
}

// Write a handoff
export async function writeHandoff(handoff: Handoff, isRolling = false): Promise<void> {
  await ensureStorageDir();
  const path = isRolling
    ? getRollingCheckpointPath(handoff.project.hash)
    : getHandoffPath(handoff.id);
  await writeFile(path, JSON.stringify(handoff, null, 2), "utf-8");
}

// Get rolling checkpoint for current project
export async function getRollingCheckpoint(projectRoot: string): Promise<Handoff | null> {
  const hash = getProjectHash(projectRoot);
  return readHandoff(hash, true);
}

// Update rolling checkpoint (merge updates)
export async function updateRollingCheckpoint(
  projectRoot: string,
  branch: string,
  updates: Partial<{
    task: string;
    files: Handoff["context"]["files"];
    todos: Handoff["todos"];
    plan: { path: string; content: string };
    userDecision: { question: string; answer: string };
  }>
): Promise<Handoff> {
  const hash = getProjectHash(projectRoot);
  let handoff = await readHandoff(hash, true);

  const now = new Date().toISOString();

  if (!handoff) {
    // Create new rolling checkpoint
    handoff = {
      id: generateHandoffId(),
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
        task: updates.task || "Working on project",
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

  // Apply updates
  handoff.updated = now;
  handoff.project.branch = branch;

  if (updates.task) {
    handoff.context.task = updates.task;
  }

  if (updates.files) {
    // Merge files, updating existing entries
    for (const newFile of updates.files) {
      const existing = handoff.context.files.find(f => f.path === newFile.path);
      if (existing) {
        existing.role = newFile.role;
      } else {
        handoff.context.files.push(newFile);
      }
    }
  }

  if (updates.todos) {
    handoff.todos = updates.todos;
  }

  if (updates.plan) {
    handoff.context.plan = {
      path: updates.plan.path,
      cachedAt: now,
      content: updates.plan.content,
    };
  }

  if (updates.userDecision) {
    handoff.context.userDecisions.push({
      ...updates.userDecision,
      timestamp: now,
    });
  }

  await writeHandoff(handoff, true);
  return handoff;
}

// Create explicit handoff from rolling checkpoint
export async function createExplicitHandoff(
  projectRoot: string,
  overrides: Partial<Handoff["context"]>
): Promise<Handoff> {
  const hash = getProjectHash(projectRoot);
  const rolling = await readHandoff(hash, true);

  const now = new Date().toISOString();
  const handoff: Handoff = rolling
    ? {
        ...rolling,
        id: generateHandoffId(),
        created: now,
        updated: now,
        ttl: "7d",
        context: {
          ...rolling.context,
          ...overrides,
        },
      }
    : {
        id: generateHandoffId(),
        version: 1,
        created: now,
        updated: now,
        ttl: "7d",
        project: {
          root: projectRoot,
          hash,
          branch: "main",
        },
        context: {
          task: overrides.task || "Working on project",
          summary: overrides.summary || "",
          state: overrides.state || "in_progress",
          files: overrides.files || [],
          decisions: overrides.decisions || [],
          blockers: overrides.blockers || [],
          nextSteps: overrides.nextSteps || [],
          userDecisions: overrides.userDecisions || [],
          plan: overrides.plan,
        },
        todos: [],
        references: {},
      };

  await writeHandoff(handoff, false);
  return handoff;
}

// Parse TTL string to milliseconds
function parseTTL(ttl: string): number {
  const match = ttl.match(/^(\d+)([hdwm])$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default 24h

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    case "w": return value * 7 * 24 * 60 * 60 * 1000;
    case "m": return value * 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

// Cleanup expired handoffs
export async function cleanupExpiredHandoffs(): Promise<number> {
  try {
    await ensureStorageDir();
    const files = await readdir(STORAGE_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const path = join(STORAGE_DIR, file);
      try {
        const content = await readFile(path, "utf-8");
        const handoff = JSON.parse(content) as Handoff;
        const ttlMs = parseTTL(handoff.ttl);
        const updated = new Date(handoff.updated).getTime();

        if (now - updated > ttlMs) {
          await unlink(path);
          cleaned++;
        }
      } catch {
        // Skip invalid files
      }
    }

    return cleaned;
  } catch {
    return 0;
  }
}

// List all handoffs for a project
export async function listHandoffs(projectRoot: string): Promise<Handoff[]> {
  try {
    await ensureStorageDir();
    const hash = getProjectHash(projectRoot);
    const files = await readdir(STORAGE_DIR);
    const handoffs: Handoff[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const path = join(STORAGE_DIR, file);
      try {
        const content = await readFile(path, "utf-8");
        const handoff = JSON.parse(content) as Handoff;
        if (handoff.project.hash === hash) {
          handoffs.push(handoff);
        }
      } catch {
        // Skip invalid files
      }
    }

    return handoffs.sort((a, b) =>
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  } catch {
    return [];
  }
}

// Get config with defaults
export async function getConfig(): Promise<SessionContextConfig> {
  const defaults: SessionContextConfig = {
    version: 1,
    tracking: {
      enabled: true,
      trackEdits: true,
      trackTodos: true,
      trackPlans: true,
      trackUserDecisions: true,
    },
    checkpoints: {
      rollingEnabled: true,
      rollingMaxAge: "24h",
      explicitTTL: "7d",
      maxStoredHandoffs: 20,
    },
    recovery: {
      autoRecover: true,
      offerCheckpointRestore: true,
      silentMarkerRecovery: true,
    },
    marker: {
      style: "hidden",
      frequency: "on_significant_edit",
    },
    integrations: {
      claudeMem: "auto",
      beads: "auto",
      harness: "auto",
      agentMail: "auto",
    },
    privacy: {
      excludePatterns: ["**/.env*", "**/secrets/**", "**/credentials*"],
    },
  };

  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as Partial<SessionContextConfig>;
    return { ...defaults, ...config };
  } catch {
    return defaults;
  }
}
