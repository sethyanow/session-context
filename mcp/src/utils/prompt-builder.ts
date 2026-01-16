import type { PromptContext } from "../types.js";

export type { PromptContext };

/**
 * Builds an inline continuation prompt for a new agent-deck session.
 * The prompt contains all context needed to resume work immediately.
 */
export function buildContinuationPrompt(ctx: PromptContext): string {
  const lines: string[] = [`# Continuing: ${ctx.task}`, ""];

  if (ctx.summary) {
    lines.push("## Summary", ctx.summary, "");
  }

  if (ctx.completed) {
    lines.push("## What was done", ctx.completed, "");
  }

  if (ctx.nextSteps?.length) {
    lines.push("## What's next");
    ctx.nextSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push("");
  }

  if (ctx.files?.length) {
    lines.push("## Key files");
    ctx.files.slice(0, 10).forEach((f) => lines.push(`- ${f.path} (${f.role})`));
    lines.push("");
  }

  const pendingTodos = ctx.todos?.filter((t) => t.status !== "completed") ?? [];
  if (pendingTodos.length) {
    lines.push("## Pending todos");
    pendingTodos.slice(0, 5).forEach((t) => lines.push(`- [ ] ${t.content}`));
    lines.push("");
  }

  lines.push("---", `Handoff: ${ctx.handoffId} | Project: ${ctx.projectRoot}`);
  return lines.join("\n");
}
