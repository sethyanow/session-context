#!/usr/bin/env bun
/**
 * PostToolUse hook for Edit/Write/NotebookEdit
 * Tracks file modifications in the rolling checkpoint
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const execAsync = promisify(exec);

// Hook receives: tool_name, tool_input (JSON), tool_output
const toolName = process.argv[2];
const toolInput = process.argv[3];
const toolOutput = process.argv[4];

interface ToolInputEdit {
  file_path: string;
  old_string?: string;
  new_string?: string;
}

interface ToolInputWrite {
  file_path: string;
  content: string;
}

async function main() {
  if (!toolInput) {
    process.exit(0);
  }

  let input: ToolInputEdit | ToolInputWrite;
  try {
    input = JSON.parse(toolInput);
  } catch {
    process.exit(0);
  }

  const filePath = input.file_path;
  if (!filePath) {
    process.exit(0);
  }

  // Determine role based on tool and content
  let role = "modified";
  if (toolName === "Write") {
    role = "created/overwritten";
  } else if (toolName === "NotebookEdit") {
    role = "notebook modified";
  }

  // Get current working directory and project hash
  const cwd = process.cwd();
  const projectHash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);

  // Storage path
  const storageDir = join(homedir(), ".claude", "session-context", "handoffs");
  const checkpointPath = join(storageDir, `${projectHash}-current.json`);

  // Ensure storage directory exists
  await mkdir(storageDir, { recursive: true });

  // Read existing checkpoint or create new
  let checkpoint: Record<string, unknown>;
  try {
    const content = await readFile(checkpointPath, "utf-8");
    checkpoint = JSON.parse(content);
  } catch {
    // Get current branch
    let branch = "main";
    try {
      const { stdout } = await execAsync("git branch --show-current", { cwd });
      branch = stdout.trim() || "main";
    } catch {}

    checkpoint = {
      id: Math.random().toString(36).slice(2, 7),
      version: 1,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      ttl: "24h",
      project: {
        root: cwd,
        hash: projectHash,
        branch,
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

  // Update checkpoint
  checkpoint.updated = new Date().toISOString();

  // Ensure context.files exists
  const context = checkpoint.context as Record<string, unknown>;
  if (!Array.isArray(context.files)) {
    context.files = [];
  }

  const files = context.files as { path: string; role: string }[];

  // Update or add file entry
  const existingIndex = files.findIndex(f => f.path === filePath);
  if (existingIndex >= 0) {
    files[existingIndex].role = role;
  } else {
    files.push({ path: filePath, role });
  }

  // Write updated checkpoint
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Silent success - no output
  process.exit(0);
}

main().catch(() => process.exit(0));
