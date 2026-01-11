import { join } from "node:path";

export interface ClaudeMemObservation {
  id: number;
  title: string;
  type: string;
  timestamp: string;
}

interface ClaudeConfig {
  mcpServers?: {
    "plugin_claude-mem_mcp-search"?: {
      url?: string;
    };
  };
}

// Check if claude-mem is available using Bun APIs
export async function isClaudeMemAvailable(): Promise<boolean> {
  try {
    const homeDir = Bun.env.HOME || process.env.HOME || "";
    const configPath = join(homeDir, ".claude.json");
    const file = Bun.file(configPath);
    if (!(await file.exists())) return false;
    const config = (await file.json()) as ClaudeConfig;
    // Check if claude-mem MCP is configured (it's a plugin, so check for the plugin MCP)
    return !!config.mcpServers?.["plugin_claude-mem_mcp-search"];
  } catch {
    return false;
  }
}

// Note: Actual claude-mem queries would be done via MCP calls from Claude
// This integration is mainly for detection and preparing observation ID references
// The actual fetching happens when Claude calls the claude-mem MCP tools

export interface ClaudeMemReference {
  available: boolean;
  observationIds?: number[];
}

// Get reference data for handoff (just IDs to fetch later)
export function createClaudeMemReference(observationIds: number[]): ClaudeMemReference {
  return {
    available: true,
    observationIds,
  };
}

// Generate hint for Claude on how to restore claude-mem context
export function getClaudeMemRestoreHint(observationIds: number[]): string {
  if (observationIds.length === 0) return "";

  return `To restore full context, fetch these claude-mem observations: ${observationIds.join(", ")}
Use: mcp__plugin_claude-mem_mcp-search__get_observations({ ids: [${observationIds.join(", ")}] })`;
}
