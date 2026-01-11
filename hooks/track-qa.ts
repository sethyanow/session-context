#!/usr/bin/env bun
/**
 * PostToolUse hook for AskUserQuestion
 * Captures user decisions in the rolling checkpoint
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

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

  // Update checkpoint
  checkpoint.updated = new Date().toISOString();

  const context = checkpoint.context as Record<string, unknown>;
  if (!Array.isArray(context.userDecisions)) {
    context.userDecisions = [];
  }

  const userDecisions = context.userDecisions as { question: string; answer: string; timestamp: string }[];
  const now = new Date().toISOString();

  // Add each Q&A pair
  for (const question of input.questions) {
    const answerKey = Object.keys(output.answers).find(k =>
      k.toLowerCase().includes(question.header?.toLowerCase() || "") ||
      question.question.toLowerCase().includes(k.toLowerCase())
    );

    if (answerKey && output.answers[answerKey]) {
      userDecisions.push({
        question: question.question,
        answer: output.answers[answerKey],
        timestamp: now,
      });
    }
  }

  // Keep only last 20 decisions to avoid bloat
  if (userDecisions.length > 20) {
    context.userDecisions = userDecisions.slice(-20);
  }

  // Write updated checkpoint
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Silent success
  process.exit(0);
}

main().catch(() => process.exit(0));
