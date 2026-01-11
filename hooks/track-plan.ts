#!/usr/bin/env bun
/**
 * PreToolUse hook for ExitPlanMode
 * Caches the plan content before exiting plan mode
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
} from "../mcp/src/utils/checkpoint.js";
import { Glob } from "bun";
import { isPlanTrackingEnabled } from "./lib/config.ts";

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
    const planFiles = Array.from(glob.scanSync(plansDir)).map(f => join(plansDir, f));
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

  // Get or create checkpoint using shared utilities
  const checkpoint = await getOrCreateCheckpoint(cwd);

  // Update checkpoint with plan
  checkpoint.updated = new Date().toISOString();

  checkpoint.context.plan = {
    path: planPath,
    cachedAt: new Date().toISOString(),
    content: planContent,
  };

  // Try to extract task from plan title
  const titleMatch = planContent.match(/^#\s+(.+)$/m);
  if (titleMatch && (!checkpoint.context.task || checkpoint.context.task === "Working on project")) {
    checkpoint.context.task = titleMatch[1];
  }

  // Write updated checkpoint
  const checkpointPath = getCheckpointPath(cwd);
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Silent success
  process.exit(0);
}

main().catch(() => process.exit(0));
