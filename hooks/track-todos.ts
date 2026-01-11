#!/usr/bin/env bun
/**
 * PostToolUse hook for TodoWrite
 * Captures todo state in the rolling checkpoint
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

// Hook receives: tool_name, tool_input (JSON), tool_output
const toolInput = process.argv[3];

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

interface ToolInputTodos {
  todos: TodoItem[];
}

async function main() {
  if (!toolInput) {
    process.exit(0);
  }

  let input: ToolInputTodos;
  try {
    input = JSON.parse(toolInput);
  } catch {
    process.exit(0);
  }

  if (!input.todos || !Array.isArray(input.todos)) {
    process.exit(0);
  }

  // Get current working directory and project hash
  const cwd = process.cwd();
  const projectHash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);

  // Storage path
  const storageDir = join(homedir(), ".claude", "session-context", "handoffs");
  const checkpointPath = join(storageDir, `${projectHash}-current.json`);

  // Ensure storage directory exists
  await mkdir(storageDir, { recursive: true });

  // Read existing checkpoint
  let checkpoint: Record<string, unknown>;
  try {
    const content = await readFile(checkpointPath, "utf-8");
    checkpoint = JSON.parse(content);
  } catch {
    // No checkpoint yet - create minimal one
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

  // Update checkpoint with new todos
  checkpoint.updated = new Date().toISOString();
  checkpoint.todos = input.todos;

  // Infer task from in-progress todo if not set
  const context = checkpoint.context as Record<string, unknown>;
  const inProgressTodo = input.todos.find(t => t.status === "in_progress");
  if (inProgressTodo && (!context.task || context.task === "Working on project")) {
    context.task = inProgressTodo.content;
  }

  // Write updated checkpoint
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Silent success
  process.exit(0);
}

main().catch(() => process.exit(0));
