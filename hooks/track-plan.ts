#!/usr/bin/env bun
/**
 * PreToolUse hook for ExitPlanMode
 * Caches the plan content before exiting plan mode
 *
 * Fallback: If direct write fails (sandbox), queues for MCP processing
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
} from "../mcp/src/utils/checkpoint.js";
import { Glob } from "bun";
import { isPlanTrackingEnabled } from "./lib/config.ts";
import {
  queueUpdate,
  isPermissionError,
  outputFallbackUsed,
} from "./lib/fallback-queue.ts";

async function main() {
  // Check if plan tracking is enabled
  if (!(await isPlanTrackingEnabled())) {
    process.exit(0);
  }

  // Get current working directory
  const cwd = process.cwd();

  // Find the most recently modified plan file
  const plansDir = join(homedir(), ".claude", "plans");
  let planPath: string | null = null;
  let planContent: string | null = null;

  try {
    const glob = new Glob("*.md");
    const planFiles = Array.from(glob.scanSync(plansDir)).map((f) => join(plansDir, f));
    if (planFiles.length > 0) {
      // Sort by modification time, get most recent
      const filesWithStats = await Promise.all(
        planFiles.map(async (f) => {
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

  // Extract task from plan title
  const titleMatch = planContent.match(/^#\s+(.+)$/m);
  const taskFromPlan = titleMatch ? titleMatch[1] : null;

  try {
    // Try direct write first
    const checkpoint = await getOrCreateCheckpoint(cwd);
    checkpoint.updated = new Date().toISOString();

    checkpoint.context.plan = {
      path: planPath,
      cachedAt: new Date().toISOString(),
      content: planContent,
    };

    // Update task from plan title if not already set
    if (taskFromPlan && (!checkpoint.context.task || checkpoint.context.task === "Working on project")) {
      checkpoint.context.task = taskFromPlan;
    }

    // Write updated checkpoint
    const checkpointPath = getCheckpointPath(cwd);
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

    // Silent success
    process.exit(0);
  } catch (error) {
    // If permission error (sandbox), queue for MCP
    if (isPermissionError(error)) {
      const queueId = await queueUpdate({
        projectRoot: cwd,
        updateType: "plan",
        payload: {
          plan: {
            path: planPath,
            cachedAt: new Date().toISOString(),
            content: planContent,
          },
          taskFromPlan,
        },
      });
      outputFallbackUsed("plan", queueId);
      process.exit(0);
    }

    // Other errors - silent failure
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
