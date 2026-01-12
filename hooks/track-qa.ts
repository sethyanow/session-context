#!/usr/bin/env bun
/**
 * PostToolUse hook for AskUserQuestion
 * Captures user decisions in the rolling checkpoint
 *
 * Fallback: If direct write fails (sandbox), queues for MCP processing
 */

import { writeFile } from "node:fs/promises";
import {
  getOrCreateCheckpoint,
  getCheckpointPath,
} from "../mcp/src/utils/checkpoint.js";
import { isUserDecisionTrackingEnabled } from "./lib/config.ts";
import {
  queueUpdate,
  isPermissionError,
  outputFallbackUsed,
} from "./lib/fallback-queue.ts";

// Hook receives: tool_name, tool_input (JSON), tool_output (JSON)
const toolInput = process.argv[3];
const toolOutput = process.argv[4];

interface Question {
  question: string;
  header?: string;
  options: { label: string; description: string }[];
}

interface ToolInputQA {
  questions: Question[];
}

interface ToolOutputQA {
  answers?: Record<string, string>;
}

async function main() {
  // Check if user decision tracking is enabled
  if (!(await isUserDecisionTrackingEnabled())) {
    process.exit(0);
  }

  if (!toolInput || !toolOutput) {
    process.exit(0);
  }

  let input: ToolInputQA;
  let output: ToolOutputQA;
  try {
    input = JSON.parse(toolInput);
    output = JSON.parse(toolOutput);
  } catch {
    process.exit(0);
  }

  if (!input.questions || !output.answers) {
    process.exit(0);
  }

  // Extract Q&A pairs
  const now = new Date().toISOString();
  const decisions: { question: string; answer: string; timestamp: string }[] = [];

  for (const question of input.questions) {
    const answerKey = Object.keys(output.answers).find(
      (k) =>
        k.toLowerCase().includes(question.header?.toLowerCase() || "") ||
        question.question.toLowerCase().includes(k.toLowerCase())
    );

    if (answerKey && output.answers[answerKey]) {
      decisions.push({
        question: question.question,
        answer: output.answers[answerKey],
        timestamp: now,
      });
    }
  }

  if (decisions.length === 0) {
    process.exit(0);
  }

  // Get current working directory
  const cwd = process.cwd();

  try {
    // Try direct write first
    const checkpoint = await getOrCreateCheckpoint(cwd);
    checkpoint.updated = new Date().toISOString();

    if (!Array.isArray(checkpoint.context.userDecisions)) {
      checkpoint.context.userDecisions = [];
    }

    // Add decisions
    checkpoint.context.userDecisions.push(...decisions);

    // Keep only last 20 decisions to avoid bloat
    if (checkpoint.context.userDecisions.length > 20) {
      checkpoint.context.userDecisions = checkpoint.context.userDecisions.slice(-20);
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
        updateType: "userDecision",
        payload: { decisions },
      });
      outputFallbackUsed("userDecision", queueId);
      process.exit(0);
    }

    // Other errors - silent failure
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
