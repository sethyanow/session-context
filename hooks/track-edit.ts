#!/usr/bin/env bun
/**
 * PostToolUse hook for Edit/Write/NotebookEdit
 * Tracks file modifications in the rolling checkpoint
 *
 * Fallback: If direct write fails (sandbox), queues for MCP processing
 */

import { writeFile } from "node:fs/promises";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
} from "../mcp/src/utils/checkpoint.js";
import { isEditTrackingEnabled } from "./lib/config.ts";
import { shouldExcludeFile } from "../mcp/src/utils/privacy.js";
import { getConfig } from "../mcp/src/storage/handoffs.js";
import {
  queueUpdate,
  isPermissionError,
  outputFallbackUsed,
} from "./lib/fallback-queue.ts";

// Hook receives: tool_name, tool_input (JSON), tool_output
const toolName = process.argv[2];
const toolInput = process.argv[3];

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
  // Check if edit tracking is enabled
  if (!(await isEditTrackingEnabled())) {
    process.exit(0);
  }

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

  // Check privacy exclusions - exit silently if file should be excluded
  const config = await getConfig();
  if (shouldExcludeFile(filePath, config.privacy.excludePatterns)) {
    process.exit(0);
  }

  // Determine role based on tool and content
  let role = "modified";
  if (toolName === "Write") {
    role = "created/overwritten";
  } else if (toolName === "NotebookEdit") {
    role = "notebook modified";
  }

  // Get current working directory
  const cwd = process.cwd();

  try {
    // Try direct write first
    const checkpoint = await getOrCreateCheckpoint(cwd);
    checkpoint.updated = new Date().toISOString();

    // Ensure context.files exists
    if (!Array.isArray(checkpoint.context.files)) {
      checkpoint.context.files = [];
    }

    // Update or add file entry
    const existingIndex = checkpoint.context.files.findIndex((f) => f.path === filePath);
    if (existingIndex >= 0) {
      checkpoint.context.files[existingIndex].role = role;
    } else {
      checkpoint.context.files.push({ path: filePath, role });
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
        updateType: "file",
        payload: { filePath, role },
      });
      outputFallbackUsed("file", queueId);
      process.exit(0);
    }

    // Other errors - silent failure
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
