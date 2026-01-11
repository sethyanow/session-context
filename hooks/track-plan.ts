#!/usr/bin/env bun
/**
 * PreToolUse hook for ExitPlanMode
 * Caches the plan content before exiting plan mode
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { glob } from "glob";

async function main() {
  // Get current working directory and project hash
  const cwd = process.cwd();
  const projectHash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);

  // Storage path
  const storageDir = join(homedir(), ".claude", "session-context", "handoffs");
  const checkpointPath = join(storageDir, `${projectHash}-current.json`);

  // Find the most recently modified plan file
  const plansDir = join(homedir(), ".claude", "plans");
  let planPath: string | null = null;
  let planContent: string | null = null;

  try {
    const planFiles = await glob("*.md", { cwd: plansDir, absolute: true });
    if (planFiles.length > 0) {
      // Sort by modification time, get most recent
      const filesWithStats = await Promise.all(
        planFiles.map(async f => {
          const stat = await Bun.file(f).stat();
          return { path: f, mtime: stat?.mtime || 0 };
        })
      );
      filesWithStats.sort((a, b) => (b.mtime as number) - (a.mtime as number));

      planPath = filesWithStats[0].path;
      planContent = await readFile(planPath, "utf-8");
    }
  } catch {
    // No plans found - that's ok
  }

  if (!planPath || !planContent) {
    process.exit(0);
  }

  // Ensure storage directory exists
  await mkdir(storageDir, { recursive: true });

  // Read existing checkpoint
  let checkpoint: Record<string, unknown>;
  try {
    const content = await readFile(checkpointPath, "utf-8");
    checkpoint = JSON.parse(content);
  } catch {
    checkpoint = {
      id: Math.random().toString(36).slice(2, 7),
      version: 1,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      ttl: "24h",
      project: {
        root: cwd,
        hash: projectHash,
        branch: "main",
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

  // Update checkpoint with plan
  checkpoint.updated = new Date().toISOString();

  const context = checkpoint.context as Record<string, unknown>;
  context.plan = {
    path: planPath,
    cachedAt: new Date().toISOString(),
    content: planContent,
  };

  // Try to extract task from plan title
  const titleMatch = planContent.match(/^#\s+(.+)$/m);
  if (titleMatch && (!context.task || context.task === "Working on project")) {
    context.task = titleMatch[1];
  }

  // Write updated checkpoint
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Silent success
  process.exit(0);
}

main().catch(() => process.exit(0));
