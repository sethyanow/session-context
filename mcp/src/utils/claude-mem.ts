const CLAUDE_MEM_PORT = 37777;
const CLAUDE_MEM_BASE = `http://localhost:${CLAUDE_MEM_PORT}`;

export interface ClaudeMemSummary {
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  next_steps?: string;
}

/**
 * Check if claude-mem worker is available.
 */
export async function isClaudeMemAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${CLAUDE_MEM_BASE}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Get the most recent session summary from claude-mem.
 * Returns null if claude-mem is unavailable or has no summaries.
 */
export async function getClaudeMemSummary(
  project: string,
): Promise<ClaudeMemSummary | null> {
  if (!(await isClaudeMemAvailable())) return null;

  try {
    const resp = await fetch(
      `${CLAUDE_MEM_BASE}/api/context/recent?project=${encodeURIComponent(project)}&limit=1`,
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    return data.summaries?.[0] ?? null;
  } catch {
    return null;
  }
}
