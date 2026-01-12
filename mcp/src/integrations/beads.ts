import { join } from "node:path";

// Simple cache to avoid duplicate bv --robot-triage calls when both
// getBeadsInfo and getBeadsTriage are called in parallel
interface TriageCache {
  data: unknown;
  timestamp: number;
  cwd: string;
}
let triageCache: TriageCache | null = null;
let pendingFetch: Promise<unknown | null> | null = null;
let pendingFetchCwd: string | null = null;
const CACHE_TTL_MS = 5000; // 5 second cache

// Reset cache - exported for testing only
export function _resetTriageCache(): void {
  triageCache = null;
  pendingFetch = null;
  pendingFetchCwd = null;
}

async function fetchTriageData(cwd: string): Promise<unknown | null> {
  // Check cache first
  if (triageCache && triageCache.cwd === cwd && Date.now() - triageCache.timestamp < CACHE_TTL_MS) {
    return triageCache.data;
  }

  // If there's already a pending fetch for this cwd, wait for it
  if (pendingFetch && pendingFetchCwd === cwd) {
    return pendingFetch;
  }

  // Start new fetch using Bun.spawn
  pendingFetchCwd = cwd;
  pendingFetch = (async () => {
    try {
      const proc = Bun.spawn(["bv", "--robot-triage"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const data = JSON.parse(stdout);
      triageCache = { data, timestamp: Date.now(), cwd };
      return data;
    } catch {
      return null;
    } finally {
      pendingFetch = null;
      pendingFetchCwd = null;
    }
  })();

  return pendingFetch;
}

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

// Check if beads is available in project using Bun APIs
export async function isBeadsAvailable(cwd: string): Promise<boolean> {
  try {
    // Check for a marker file within .beads directory since Bun.file() checks files, not directories
    const markerFile = Bun.file(join(cwd, ".beads", ".keep"));
    if (await markerFile.exists()) return true;

    // Fallback: check if any file exists in .beads by trying to read the directory
    const proc = Bun.spawn(["test", "-d", join(cwd, ".beads")]);
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

// Get basic beads counts by extracting from triage data's quick_ref
// bv --robot-triage returns: { generated_at, data_hash, triage: { quick_ref: { open_count, ... } } }
export async function getBeadsInfo(cwd: string): Promise<BeadsInfo | null> {
  if (!(await isBeadsAvailable(cwd))) return null;

  const response = (await fetchTriageData(cwd)) as {
    triage?: { quick_ref?: Record<string, number> };
  } | null;
  if (!response) {
    return { open: 0, actionable: 0, blocked: 0, in_progress: 0 };
  }

  // quick_ref is nested inside response.triage
  const quickRef = response.triage?.quick_ref || {};
  return {
    open: quickRef.open_count ?? 0,
    actionable: quickRef.actionable_count ?? 0,
    blocked: quickRef.blocked_count ?? 0,
    in_progress: quickRef.in_progress_count ?? 0,
  };
}

// Get full triage data
export async function getBeadsTriage(cwd: string): Promise<BeadsTriage | null> {
  if (!(await isBeadsAvailable(cwd))) return null;

  const triage = (await fetchTriageData(cwd)) as { data_hash?: string } | null;
  if (!triage) return null;

  return {
    generated_at: new Date().toISOString(),
    data_hash: triage.data_hash || "",
    triage,
  };
}
