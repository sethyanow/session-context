import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentMailInfo {
  available: boolean;
  projectRegistered: boolean;
  error?: string;
}

interface ClaudeConfig {
  mcpServers?: {
    "mcp-agent-mail"?: {
      url?: string;
      headers?: { Authorization?: string };
    };
  };
}

// Check if agent mail is configured
export async function isAgentMailConfigured(): Promise<boolean> {
  try {
    const configPath = join(homedir(), ".claude.json");
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as ClaudeConfig;
    return !!config.mcpServers?.["mcp-agent-mail"]?.url;
  } catch {
    return false;
  }
}

// Get agent mail config
async function getAgentMailConfig(): Promise<{
  url: string;
  headers?: Record<string, string>;
} | null> {
  try {
    const configPath = join(homedir(), ".claude.json");
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as ClaudeConfig;
    const mailConfig = config.mcpServers?.["mcp-agent-mail"];
    if (!mailConfig?.url) return null;
    return { url: mailConfig.url, headers: mailConfig.headers };
  } catch {
    return null;
  }
}

// Check agent mail status
export async function getAgentMailInfo(cwd: string): Promise<AgentMailInfo> {
  const config = await getAgentMailConfig();
  if (!config) {
    return { available: false, projectRegistered: false, error: "Not configured" };
  }

  try {
    // Health check
    const healthResponse = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: { name: "health_check", arguments: {} },
      }),
    });

    if (!healthResponse.ok) {
      return { available: false, projectRegistered: false, error: "Health check failed" };
    }

    // Check project registration
    const projectResponse = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tools/call",
        params: { name: "ensure_project", arguments: { human_key: cwd } },
      }),
    });

    const projectData = await projectResponse.json();
    const projectRegistered = !!projectData?.result?.content?.[0]?.text;

    return { available: true, projectRegistered };
  } catch (e) {
    return {
      available: false,
      projectRegistered: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
