#!/usr/bin/env bun

/**
 * SessionStart hook that:
 * 1. Pre-loads session status data (git, beads, harness, agentmail)
 * 2. Injects instruction to invoke /start skill when user sends "."
 *
 * By gathering data here, we save the MCP call when /start runs.
 */

import { getGitInfo } from "../mcp/src/integrations/git.js";
import { getBeadsInfo, getBeadsTriage } from "../mcp/src/integrations/beads.js";
import { getHarnessInfo } from "../mcp/src/integrations/harness.js";
import { getAgentMailInfo } from "../mcp/src/integrations/agent-mail.js";
import { getRollingCheckpoint } from "../mcp/src/storage/handoffs.js";

// Get project root from environment (set by Claude Code hooks)
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

interface RecoveryInfo {
  available: boolean;
  id?: string;
  age?: string;
}

// Calculate human-readable age from timestamp
function getAge(updatedIso: string): string {
  const updated = new Date(updatedIso).getTime();
  const now = Date.now();
  const diffMs = now - updated;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMins > 0) return `${diffMins}m`;
  return "< 1m";
}

// Get recovery checkpoint metadata (not full handoff)
async function getRecoveryInfo(cwd: string): Promise<RecoveryInfo> {
  try {
    const handoff = await getRollingCheckpoint(cwd);
    if (!handoff) {
      return { available: false };
    }

    return {
      available: true,
      id: handoff.id,
      age: getAge(handoff.updated),
    };
  } catch {
    return { available: false };
  }
}

async function main() {
  // Gather data in parallel - each wrapped in try/catch for resilience
  const [project, harness, beads, beadsTriage, agentmail, recovery] = await Promise.all([
    getGitInfo(projectRoot).catch(() => null),
    getHarnessInfo(projectRoot).catch(() => null),
    getBeadsInfo(projectRoot).catch(() => null),
    getBeadsTriage(projectRoot).catch(() => null),
    getAgentMailInfo(projectRoot).catch(() => ({ available: false, projectRegistered: false })),
    getRecoveryInfo(projectRoot),
  ]);

  const sessionStatus = {
    level: "standard",
    sections: ["project", "harness", "beads", "beads_triage", "agentmail"],
    integrations: {
      claudeMem: false, // Can't detect MCP config from hook easily
      beads: !!beads,
      harness: !!harness,
      agentMail: agentmail?.available ?? false,
    },
    recovery,
    project,
    harness,
    beads,
    beads_triage: beadsTriage,
    agentmail,
  };

  // Use hookSpecificOutput.additionalContext to inject the session status
  // This is the only way to pass custom data that Claude Code will recognize
  const instruction = {
    continue: true,
    suppressOutput: true,
    systemMessage: `When the user sends only a period "." as their message, immediately invoke the /start skill using the Skill tool before any other response.

Example:
user: "."
assistant: [Invokes Skill tool with skill: "start"]`,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `# Pre-loaded Session Status

The following session context was gathered at startup. Use this data directly instead of calling get_session_status MCP.

\`\`\`json
${JSON.stringify(sessionStatus, null, 2)}
\`\`\`
`,
    },
  };

  console.log(JSON.stringify(instruction));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // On error, still output basic instruction without session data
    console.log(
      JSON.stringify({
        continue: true,
        suppressOutput: true,
        systemMessage: `When the user sends only a period "." as their message, immediately invoke the /start skill using the Skill tool before any other response.`,
      }),
    );
    process.exit(0);
  });
