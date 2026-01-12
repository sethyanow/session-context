#!/usr/bin/env bun
/**
 * PostToolUse hook for TodoWrite
 * Captures todo state in the rolling checkpoint
 *
 * Fallback: If direct write fails (sandbox), queues for MCP processing
 */

import { writeFile } from "node:fs/promises";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
} from "../mcp/src/utils/checkpoint.js";
import { isTodoTrackingEnabled } from "./lib/config.ts";
import {
  queueUpdate,
  isPermissionError,
  outputFallbackUsed,
} from "./lib/fallback-queue.ts";

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
  // Check if todo tracking is enabled
  if (!(await isTodoTrackingEnabled())) {
    process.exit(0);
  }

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

  // Get current working directory
  const cwd = process.cwd();

  try {
    // Try direct write first
    const checkpoint = await getOrCreateCheckpoint(cwd);
    checkpoint.updated = new Date().toISOString();
    checkpoint.todos = input.todos;

    // Infer task from in-progress todo if not set
    const inProgressTodo = input.todos.find((t) => t.status === "in_progress");
    if (inProgressTodo && (!checkpoint.context.task || checkpoint.context.task === "Working on project")) {
      checkpoint.context.task = inProgressTodo.content;
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
        updateType: "todo",
        payload: { todos: input.todos },
      });
      outputFallbackUsed("todo", queueId);
      process.exit(0);
    }

    // Other errors - silent failure
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
