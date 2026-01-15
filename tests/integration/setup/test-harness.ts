/**
 * Test harness for simulating Claude sessions
 *
 * Provides programmatic control over Claude interactions
 * by invoking hooks directly and managing isolated test state
 */
import { spawn } from "bun";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface HookInvocation {
  hookScript: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
}

export interface TestContext {
  projectRoot: string;
  homeDir: string;
  queueDir: string;
  handoffDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated test context with temp directories
 */
export async function createTestContext(
  prefix = "session-context-test"
): Promise<TestContext> {
  const testId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const baseDir = join(tmpdir(), testId);
  const projectRoot = join(baseDir, "project");
  const homeDir = join(baseDir, "home");
  const queueDir = join(tmpdir(), "claude", "session-context-queue");
  const handoffDir = join(homeDir, ".claude", "session-context", "handoffs");

  await mkdir(projectRoot, { recursive: true });
  await mkdir(handoffDir, { recursive: true });
  await mkdir(queueDir, { recursive: true });

  // Initialize as git repo (many features depend on git)
  const gitInit = spawn(["git", "init"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  await gitInit.exited;

  // Configure git user for commits
  await spawn(["git", "config", "user.email", "test@test.com"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exited;

  await spawn(["git", "config", "user.name", "Test"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exited;

  // Create a sample file and initial commit
  await writeFile(join(projectRoot, "sample.ts"), "// sample file\n");
  await spawn(["git", "add", "."], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
  await spawn(["git", "commit", "-m", "Initial commit"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exited;

  return {
    projectRoot,
    homeDir,
    queueDir,
    handoffDir,
    cleanup: async () => {
      try {
        await rm(baseDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Invoke a hook script directly
 */
export async function invokeHook(
  ctx: TestContext,
  hookPath: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput = ""
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const pluginRoot = join(process.cwd());

  const proc = spawn({
    cmd: ["bun", hookPath, toolName, JSON.stringify(toolInput), toolOutput],
    cwd: ctx.projectRoot,
    env: {
      ...process.env,
      HOME: ctx.homeDir,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Simulate a series of Claude tool invocations
 */
export async function simulateSession(
  ctx: TestContext,
  invocations: HookInvocation[]
): Promise<void> {
  const pluginRoot = process.cwd();

  for (const inv of invocations) {
    await invokeHook(
      ctx,
      join(pluginRoot, "hooks", inv.hookScript),
      inv.toolName,
      inv.toolInput,
      inv.toolOutput || ""
    );
  }
}

/**
 * Wait for a condition to become true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(interval);
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}
