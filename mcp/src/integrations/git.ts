import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Run command and return stdout or null on error
async function runCommand(cmd: string, cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 30000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface GitStatus {
  branch: string;
  uncommitted: number;
  files: { path: string; status: string }[];
}

export interface GitInfo {
  root: string;
  branch: string;
  uncommitted: number;
  recentCommits: { hash: string; message: string; date: string }[];
}

// Get current branch
export async function getBranch(cwd: string): Promise<string | null> {
  return runCommand("git branch --show-current", cwd);
}

// Get git status
export async function getStatus(cwd: string): Promise<GitStatus | null> {
  const branch = await getBranch(cwd);
  if (!branch) return null;

  const statusOutput = await runCommand("git status --porcelain", cwd);
  const files: { path: string; status: string }[] = [];

  if (statusOutput) {
    for (const line of statusOutput.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim();
      const path = line.slice(3);
      files.push({ path, status });
    }
  }

  return {
    branch,
    uncommitted: files.length,
    files,
  };
}

// Get recent commits
export async function getRecentCommits(
  cwd: string,
  limit = 5,
): Promise<{ hash: string; message: string; date: string }[]> {
  const output = await runCommand(`git log --oneline --format="%h|%s|%ci" -n ${limit}`, cwd);

  if (!output) return [];

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, message, date] = line.split("|");
      return { hash, message, date };
    });
}

// Get full git info
export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  const status = await getStatus(cwd);
  if (!status) return null;

  const recentCommits = await getRecentCommits(cwd);

  return {
    root: cwd,
    branch: status.branch,
    uncommitted: status.uncommitted,
    recentCommits,
  };
}

// Check if path is a git repo
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runCommand("git rev-parse --is-inside-work-tree", cwd);
  return result === "true";
}
