export interface AgentDeckResult {
  success: boolean;
  sessionName?: string;
  error?: string;
}

/**
 * Check if agent-deck CLI is installed.
 */
export async function isAgentDeckInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "agent-deck"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Spawn a new agent-deck session with the given prompt.
 * Uses start + send pattern since -m flag can hang.
 */
export async function spawnAgentDeckSession(
  sessionName: string,
  projectPath: string,
  recoveryPrompt: string,
): Promise<AgentDeckResult> {
  if (!(await isAgentDeckInstalled())) {
    return { success: false, error: "agent-deck not installed" };
  }

  // Create session
  const addProc = Bun.spawn(
    ["agent-deck", "add", "-t", sessionName, "-c", "claude", projectPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  await addProc.exited;
  if (addProc.exitCode !== 0) {
    const stderr = await new Response(addProc.stderr).text();
    // Session might already exist - try to start anyway
    if (!stderr.includes("already exists")) {
      return { success: false, error: `Failed to create session: ${stderr}` };
    }
  }

  // Start session (launches Claude in tmux background)
  const startProc = Bun.spawn(
    ["agent-deck", "session", "start", sessionName],
    { stdout: "pipe", stderr: "pipe" },
  );
  await startProc.exited;
  if (startProc.exitCode !== 0) {
    const stderr = await new Response(startProc.stderr).text();
    return { success: false, error: `Failed to start session: ${stderr}` };
  }

  // Wait a moment for session to initialize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Send the continuation prompt
  const sendProc = Bun.spawn(
    ["agent-deck", "session", "send", sessionName, recoveryPrompt],
    { stdout: "pipe", stderr: "pipe" },
  );
  await sendProc.exited;
  if (sendProc.exitCode !== 0) {
    const stderr = await new Response(sendProc.stderr).text();
    return { success: false, error: `Failed to send prompt: ${stderr}` };
  }

  return { success: true, sessionName };
}

/**
 * Generate a session name from task description and handoff ID.
 * Format: {short-task}-{handoff_id}
 * Example: auth-refactor-abc12
 */
export function generateSessionName(task: string, handoffId: string): string {
  // Extract 2-3 key words from task, lowercase, hyphenated
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);

  const taskSlug = words.join("-") || "session";
  return `${taskSlug}-${handoffId}`;
}
