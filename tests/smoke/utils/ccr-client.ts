/**
 * Claude Code Router (ccr) client for smoke tests
 *
 * Provides a simple interface to drive Claude through ccr for real API testing.
 * Uses subprocess spawning to run claude commands with controlled input.
 */
import { spawn, type Subprocess } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CcrClientOptions {
  /** Project directory for Claude session */
  projectDir: string;
  /** Home directory override (for isolated testing) */
  homeDir?: string;
  /** Timeout for each prompt in milliseconds */
  promptTimeoutMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface CcrSession {
  /** Send a prompt to Claude and wait for response */
  send(prompt: string): Promise<string>;
  /** Get the project directory */
  projectDir: string;
  /** Clean up the session */
  cleanup(): Promise<void>;
}

/**
 * Check if claude CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    const proc = spawn(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if ANTHROPIC_API_KEY is set
 */
export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Create a Claude session for testing
 *
 * Each call to `send()` spawns a new claude process with the -p flag.
 * This is simpler than maintaining a persistent session and works for smoke tests.
 */
export async function createCcrSession(
  options: CcrClientOptions,
): Promise<CcrSession> {
  const { projectDir, homeDir, promptTimeoutMs = 60000, verbose = false } = options;

  const log = verbose ? console.log.bind(console) : () => {};

  // Ensure project directory exists
  await mkdir(projectDir, { recursive: true });

  // Create session HOME if provided
  const sessionHome = homeDir || process.env.HOME;

  return {
    projectDir,

    async send(prompt: string): Promise<string> {
      log(`[ccr] Sending prompt: ${prompt.slice(0, 100)}...`);

      const env = {
        ...process.env,
        HOME: sessionHome,
      };

      // Use claude -p for non-interactive prompt execution
      const proc = spawn(["claude", "-p", prompt], {
        cwd: projectDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Collect output
      const chunks: Uint8Array[] = [];
      const reader = proc.stdout.getReader();

      const timeout = setTimeout(() => {
        proc.kill();
      }, promptTimeoutMs);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }

        await proc.exited;
        clearTimeout(timeout);

        const output = Buffer.concat(chunks).toString("utf-8");
        log(`[ccr] Response: ${output.slice(0, 200)}...`);

        return output;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    },

    async cleanup(): Promise<void> {
      // Nothing to clean up for subprocess-based approach
      log("[ccr] Session cleanup complete");
    },
  };
}

/**
 * Run a test with a Claude session, handling setup and teardown
 */
export async function withCcrSession<T>(
  options: CcrClientOptions,
  fn: (session: CcrSession) => Promise<T>,
): Promise<T> {
  const session = await createCcrSession(options);
  try {
    return await fn(session);
  } finally {
    await session.cleanup();
  }
}
