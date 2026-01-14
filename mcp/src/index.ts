#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  CreateHandoffParams,
  GetSessionStatusParams,
  Handoff,
  IntegrationStatus,
  UpdateCheckpointParams,
} from "./types.js";

import {
  cleanupExpiredHandoffs,
  createExplicitHandoff,
  getConfig,
  getProjectHash,
  getRollingCheckpoint,
  readHandoff,
  updateRollingCheckpoint,
} from "./storage/handoffs.js";

import { processQueue, getQueueStatus } from "./utils/queue-processor.js";

import {
  getAgentMailInfo,
  isAgentMailConfigured,
} from "./integrations/agent-mail.js";
import {
  getBeadsInfo,
  getBeadsTriage,
  isBeadsAvailable,
} from "./integrations/beads.js";
import {
  getClaudeMemRestoreHint,
  isClaudeMemAvailable,
} from "./integrations/claude-mem.js";
import { getBranch, getGitInfo } from "./integrations/git.js";
import { getHarnessInfo, isHarnessAvailable } from "./integrations/harness.js";

// Create MCP server
const server = new Server(
  {
    name: "session-context",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Detect available integrations
async function detectIntegrations(cwd: string): Promise<IntegrationStatus> {
  const [claudeMem, beads, harness, agentMail] = await Promise.all([
    isClaudeMemAvailable(),
    isBeadsAvailable(cwd),
    isHarnessAvailable(cwd),
    isAgentMailConfigured(),
  ]);

  return { claudeMem, beads, harness, agentMail };
}

// Extract plan summary: title and first few key points
function extractPlanSummary(
  planContent: string,
): { title: string; points: string[] } | null {
  if (!planContent) return null;

  const lines = planContent.split("\n");
  let title = "";
  const points: string[] = [];

  for (const line of lines) {
    // Find title (first # heading)
    if (!title && line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    // Collect numbered steps or bullet points under ## headings
    if (line.match(/^(\d+\.|[-*])\s+\S/)) {
      const point = line.replace(/^(\d+\.|[-*])\s+/, "").trim();
      if (point.length > 0 && point.length < 100 && points.length < 5) {
        points.push(point);
      }
    }
    // Stop after we have enough
    if (points.length >= 5) break;
  }

  return title ? { title, points } : null;
}

// Generate continuation prompt with rich context
function generateContinuationPrompt(handoff: Handoff): string {
  const { context, todos, project } = handoff;
  const lines: string[] = [];

  // Header with task
  const taskTitle =
    context.task !== "Working on project"
      ? context.task
      : context.summary || "Session";
  lines.push(`# Continue: ${taskTitle}`, "");

  // Summary if different from task
  if (context.summary && context.summary !== context.task) {
    lines.push(context.summary, "");
  }

  // Files worked on (concrete, specific)
  if (context.files.length > 0) {
    lines.push("## Files");
    const modified = context.files.filter(
      (f) => f.role === "modified" || f.role === "edited",
    );
    const created = context.files.filter((f) => f.role === "created");
    const read = context.files.filter(
      (f) => f.role === "read" || f.role === "reference",
    );

    if (modified.length > 0) {
      lines.push(
        `Modified: ${modified
          .slice(0, 5)
          .map((f) => f.path.split("/").pop())
          .join(", ")}`,
      );
    }
    if (created.length > 0) {
      lines.push(
        `Created: ${created
          .slice(0, 3)
          .map((f) => f.path.split("/").pop())
          .join(", ")}`,
      );
    }
    if (read.length > 0 && modified.length === 0) {
      lines.push(
        `Reviewed: ${read
          .slice(0, 3)
          .map((f) => f.path.split("/").pop())
          .join(", ")}`,
      );
    }
    lines.push("");
  }

  // Plan summary (if available)
  if (context.plan?.content) {
    const summary = extractPlanSummary(context.plan.content);
    if (summary) {
      lines.push("## Plan");
      if (summary.title !== taskTitle) {
        lines.push(summary.title);
      }
      if (summary.points.length > 0) {
        summary.points.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
      }
      lines.push("");
    }
  }

  // Todos (in progress first, then pending)
  const inProgress = todos.filter((t) => t.status === "in_progress");
  const pending = todos.filter((t) => t.status === "pending");
  if (inProgress.length > 0 || pending.length > 0) {
    lines.push("## Todos");
    inProgress.forEach((t) => lines.push(`- [→] ${t.content}`));
    pending.slice(0, 5).forEach((t) => lines.push(`- [ ] ${t.content}`));
    lines.push("");
  }

  // Decisions made (concrete context)
  if (context.decisions.length > 0) {
    lines.push("## Decisions");
    context.decisions.slice(0, 4).forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  // User Q&A (recent decisions that shaped the work)
  if (context.userDecisions && context.userDecisions.length > 0) {
    lines.push("## User Decisions");
    context.userDecisions.slice(-3).forEach((ud) => {
      lines.push(`Q: ${ud.question}`);
      lines.push(`A: ${ud.answer}`);
    });
    lines.push("");
  }

  // Blockers (if any)
  if (context.blockers.length > 0) {
    lines.push("## Blocked On");
    context.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // Next steps (actionable)
  if (context.nextSteps.length > 0) {
    lines.push("## Next");
    context.nextSteps
      .slice(0, 3)
      .forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push(`Branch: ${project.branch} | Session: ${handoff.id}`);
  lines.push("Run /start to load full context.");

  return lines.join("\n");
}

// Tool: get_session_status
async function handleGetSessionStatus(
  params: GetSessionStatusParams,
  cwd: string,
) {
  const _config = await getConfig();
  const integrations = await detectIntegrations(cwd);

  // Check for handoff recovery
  let recoveredHandoff: Handoff | null = null;
  let recoveryInfo: { available: boolean; id?: string; age?: string } = {
    available: false,
  };

  if (params.handoff) {
    // Explicit handoff ID provided - need projectHash to find the file
    const projectHash = getProjectHash(cwd);
    recoveredHandoff = await readHandoff(params.handoff, false, projectHash);
  } else if (params.autoRecover !== false) {
    // Check for rolling checkpoint
    const rolling = await getRollingCheckpoint(cwd);
    if (rolling) {
      const ageMs = Date.now() - new Date(rolling.updated).getTime();
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24h default

      if (ageMs < maxAgeMs) {
        recoveryInfo = {
          available: true,
          id: rolling.id,
          age: ageHours < 1 ? "< 1h" : `${ageHours}h`,
        };
        // Don't auto-load, just indicate it's available
      }
    }
  }

  // Gather fresh state based on level
  const level = params.level ?? "minimal";
  const sections = new Set<string>();

  // Determine sections to include
  if (params.just && params.just.length > 0) {
    params.just.forEach((s) => sections.add(s));
  } else {
    // Level-based sections
    sections.add("project");

    if (level === "minimal" || level === "standard" || level === "full") {
      if (integrations.harness) sections.add("harness");
      if (integrations.beads) sections.add("beads");
    }

    if (level === "standard" || level === "full") {
      if (integrations.beads) sections.add("beads_triage");
      if (integrations.agentMail) sections.add("agentmail");
    }

    if (level === "full") {
      if (integrations.claudeMem) sections.add("claude_mem");
    }

    // Add "also" sections
    if (params.also) {
      params.also.forEach((s) => sections.add(s));
    }
  }

  // Gather data for each section
  const result: Record<string, unknown> = {
    level: params.just ? "custom" : level,
    sections: Array.from(sections),
    integrations,
  };

  // Add recovery info
  if (recoveredHandoff) {
    result.recovered = {
      handoff: recoveredHandoff,
      claudeMemHint: recoveredHandoff.references.claudeMemIds
        ? getClaudeMemRestoreHint(recoveredHandoff.references.claudeMemIds)
        : null,
    };
  } else if (recoveryInfo.available) {
    result.recovery = recoveryInfo;
  }

  // Gather each section in parallel
  const gatherPromises: Promise<void>[] = [];

  if (sections.has("project")) {
    gatherPromises.push(
      getGitInfo(cwd).then((info) => {
        if (info) result.project = info;
      }),
    );
  }

  if (sections.has("harness") && integrations.harness) {
    gatherPromises.push(
      getHarnessInfo(cwd).then((info) => {
        if (info) result.harness = info;
      }),
    );
  }

  if (sections.has("beads") && integrations.beads) {
    gatherPromises.push(
      getBeadsInfo(cwd).then((info) => {
        if (info) result.beads = info;
      }),
    );
  }

  if (sections.has("beads_triage") && integrations.beads) {
    gatherPromises.push(
      getBeadsTriage(cwd).then((info) => {
        if (info) result.beads_triage = info;
      }),
    );
  }

  if (sections.has("agentmail") && integrations.agentMail) {
    gatherPromises.push(
      getAgentMailInfo(cwd).then((info) => {
        result.agentmail = info;
      }),
    );
  }

  await Promise.all(gatherPromises);

  return result;
}

// Tool: create_handoff
async function handleCreateHandoff(params: CreateHandoffParams, cwd: string) {
  const branch = (await getBranch(cwd)) ?? "main";

  // Create explicit handoff from rolling checkpoint + overrides
  // Filter out undefined overrides to avoid overwriting existing context
  const overrides: Partial<Handoff["context"]> = { task: params.task };
  if (params.summary !== undefined) overrides.summary = params.summary;
  if (params.nextSteps !== undefined) overrides.nextSteps = params.nextSteps;
  if (params.decisions !== undefined) overrides.decisions = params.decisions;

  const handoff = await createExplicitHandoff(cwd, overrides);

  // Generate continuation prompt
  const prompt = generateContinuationPrompt(handoff);

  return {
    id: handoff.id,
    prompt,
    stored: true,
    project: {
      root: cwd,
      hash: handoff.project.hash,
      branch,
    },
    summary: {
      task: handoff.context.task,
      files: handoff.context.files.length,
      decisions: handoff.context.decisions.length,
      todos: handoff.todos.length,
      hasPlan: !!handoff.context.plan,
    },
  };
}

// Tool: update_checkpoint
async function handleUpdateCheckpoint(
  params: UpdateCheckpointParams,
  cwd: string,
) {
  const config = await getConfig();
  const branch = (await getBranch(cwd)) ?? "main";

  // First, process any queued updates from hooks that couldn't write directly
  const queueResult = await processQueue();

  // Build updates object based on configuration
  const updates: Partial<{
    task: string;
    files: Handoff["context"]["files"];
    todos: Handoff["todos"];
    plan: { path: string; content: string };
    userDecision: { question: string; answer: string };
  }> = {};

  // Always allow task updates
  if (params.task) {
    updates.task = params.task;
  }

  // Only include files if trackEdits is enabled
  if (config.tracking.enabled && config.tracking.trackEdits && params.files) {
    updates.files = params.files;
  }

  // Only include todos if trackTodos is enabled
  if (config.tracking.enabled && config.tracking.trackTodos && params.todos) {
    updates.todos = params.todos;
  }

  // Only include plan if trackPlans is enabled
  if (config.tracking.enabled && config.tracking.trackPlans && params.plan) {
    updates.plan = { path: params.plan.path, content: params.plan.content };
  }

  // Only include userDecision if trackUserDecisions is enabled
  if (
    config.tracking.enabled &&
    config.tracking.trackUserDecisions &&
    params.userDecision
  ) {
    updates.userDecision = params.userDecision;
  }

  const handoff = await updateRollingCheckpoint(cwd, branch, updates);

  return {
    id: handoff.id,
    updated: handoff.updated,
    files: handoff.context.files.length,
    todos: handoff.todos.length,
    queueProcessed: queueResult.processed,
  };
}

// Tool: process_queue
async function handleProcessQueue() {
  const result = await processQueue();
  const status = await getQueueStatus();

  return {
    processed: result.processed,
    errors: result.errors,
    byProject: result.byProject,
    remaining: status.pending,
  };
}

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_session_status",
        description: `Gather session startup data and recover from handoffs.

Returns project context including git status, integrations (beads, harness, agent-mail),
and handoff recovery information.

Levels:
- minimal (default): project, harness, beads counts
- standard: + beads_triage, agentmail
- full: + claude_mem references

Use "handoff" param to restore a specific handoff by ID.
Use "autoRecover" (default true) to check for rolling checkpoints.`,
        inputSchema: {
          type: "object",
          properties: {
            level: {
              type: "string",
              description:
                "Output level: minimal, standard, or full (default: minimal)",
            },
            also: {
              type: "array",
              items: { type: "string" },
              description: "Additional sections to include",
            },
            just: {
              type: "array",
              items: { type: "string" },
              description: "Only include these sections (ignores level)",
            },
            handoff: {
              type: "string",
              description: "Handoff ID to restore",
            },
            autoRecover: {
              type: "boolean",
              description: "Check for rolling checkpoint (default: true)",
            },
          },
        },
      },
      {
        name: "create_handoff",
        description: `Create an explicit handoff checkpoint for session continuation.

Saves current working state and generates a continuation prompt
that can be used to resume in a new session.`,
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "What we were working on (required)",
            },
            summary: {
              type: "string",
              description: "Brief description of current state",
            },
            nextSteps: {
              type: "array",
              items: { type: "string" },
              description: "What to do next",
            },
            decisions: {
              type: "array",
              items: { type: "string" },
              description: "Key decisions made this session",
            },
            includeClaudeMemRecent: {
              type: "number",
              description: "Pull last N claude-mem observations (default: 10)",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "update_checkpoint",
        description: `Update the rolling checkpoint with new state (called by hooks).

This is typically called automatically by PostToolUse hooks
to keep the checkpoint current.`,
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "Current task description",
            },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  role: { type: "string" },
                },
                required: ["path", "role"],
              },
              description: "Files being worked on",
            },
            todos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  content: { type: "string" },
                  status: {
                    type: "string",
                  },
                },
                required: ["content", "status"],
              },
              description: "Current todo state",
            },
            plan: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              description: "Plan file to cache",
            },
            userDecision: {
              type: "object",
              properties: {
                question: { type: "string" },
                answer: { type: "string" },
              },
              description: "User decision from AskUserQuestion",
            },
          },
        },
      },
      {
        name: "process_queue",
        description: `Process queued updates from hooks that couldn't write directly.

When hooks run in sandboxed environments, they may not be able to write
to ~/.claude/session-context/. Instead, they queue updates to /tmp/claude/.
This tool processes that queue and applies updates to the checkpoint.

Called automatically by update_checkpoint, but can be invoked manually
to process pending updates.`,
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const cwd = process.cwd();
  const toolName = request.params.name;
  const args = (request.params.arguments || {}) as Record<string, unknown>;

  let result: unknown;

  switch (toolName) {
    case "get_session_status":
      result = await handleGetSessionStatus(
        args as unknown as GetSessionStatusParams,
        cwd,
      );
      break;
    case "create_handoff":
      result = await handleCreateHandoff(
        args as unknown as CreateHandoffParams,
        cwd,
      );
      break;
    case "update_checkpoint":
      result = await handleUpdateCheckpoint(
        args as unknown as UpdateCheckpointParams,
        cwd,
      );
      break;
    case "process_queue":
      result = await handleProcessQueue();
      break;
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// Startup: cleanup and process queue
async function main() {
  // Cleanup expired handoffs
  await cleanupExpiredHandoffs();

  // Process any queued updates from hooks that ran before MCP started
  const queueResult = await processQueue();
  if (queueResult.processed > 0) {
    console.error(
      `Processed ${queueResult.processed} queued updates from hooks`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("session-context MCP server running on stdio");
}

main().catch(console.error);
