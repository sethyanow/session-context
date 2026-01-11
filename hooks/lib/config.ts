/**
 * Configuration utility for hooks
 * Provides functions to check if tracking features are enabled
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

interface SessionContextConfig {
  version: number;
  tracking: {
    enabled: boolean;
    trackEdits: boolean;
    trackTodos: boolean;
    trackPlans: boolean;
    trackUserDecisions: boolean;
  };
}

// Allow test override via environment variable
const getConfigPath = () =>
  process.env.SESSION_CONTEXT_CONFIG_PATH ||
  join(homedir(), ".claude", "session-context", "config.json");

const CONFIG_PATH = getConfigPath();

// Cache for config to avoid reading file multiple times
let configCache: SessionContextConfig | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get configuration with defaults
 */
export async function getConfig(): Promise<SessionContextConfig> {
  const defaults: SessionContextConfig = {
    version: 1,
    tracking: {
      enabled: true,
      trackEdits: true,
      trackTodos: true,
      trackPlans: true,
      trackUserDecisions: true,
    },
  };

  // Return cached config if still fresh
  const now = Date.now();
  if (configCache && now - cacheTime < CACHE_TTL) {
    return configCache;
  }

  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as Partial<SessionContextConfig>;
    configCache = { ...defaults, ...config } as SessionContextConfig;
    cacheTime = now;
    return configCache;
  } catch {
    configCache = defaults;
    cacheTime = now;
    return defaults;
  }
}

/**
 * Check if tracking is globally enabled
 */
export async function isTrackingEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.tracking.enabled;
}

/**
 * Check if edit tracking is enabled
 */
export async function isEditTrackingEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.tracking.enabled && config.tracking.trackEdits;
}

/**
 * Check if todo tracking is enabled
 */
export async function isTodoTrackingEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.tracking.enabled && config.tracking.trackTodos;
}

/**
 * Check if plan tracking is enabled
 */
export async function isPlanTrackingEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.tracking.enabled && config.tracking.trackPlans;
}

/**
 * Check if user decision tracking is enabled
 */
export async function isUserDecisionTrackingEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.tracking.enabled && config.tracking.trackUserDecisions;
}

/**
 * Clear the config cache (useful for testing)
 */
export function clearConfigCache(): void {
  configCache = null;
  cacheTime = 0;
}
