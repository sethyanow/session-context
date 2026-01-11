import { exec } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";
import { join } from "path";

const execAsync = promisify(exec);

export interface BeadsInfo {
  open: number;
  actionable: number;
  blocked: number;
  in_progress: number;
}

export interface BeadsTriage {
  generated_at: string;
  data_hash: string;
  triage: unknown;
}

// Check if beads is available in project
export async function isBeadsAvailable(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, ".beads"));
    return true;
  } catch {
    return false;
  }
}

// Get basic beads counts
export async function getBeadsInfo(cwd: string): Promise<BeadsInfo | null> {
  if (!await isBeadsAvailable(cwd)) return null;

  try {
    const { stdout } = await execAsync("bd stats --json", { cwd, timeout: 10000 });
    const stats = JSON.parse(stdout);
    return {
      open: stats.open ?? 0,
      actionable: stats.actionable ?? 0,
      blocked: stats.blocked ?? 0,
      in_progress: stats.in_progress ?? 0,
    };
  } catch {
    return { open: 0, actionable: 0, blocked: 0, in_progress: 0 };
  }
}

// Get full triage data
export async function getBeadsTriage(cwd: string): Promise<BeadsTriage | null> {
  if (!await isBeadsAvailable(cwd)) return null;

  try {
    const { stdout } = await execAsync("bv --robot-triage", { cwd, timeout: 30000 });
    const triage = JSON.parse(stdout);
    return {
      generated_at: new Date().toISOString(),
      data_hash: triage.data_hash || "",
      triage,
    };
  } catch {
    return null;
  }
}
