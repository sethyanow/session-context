import { readFile, access } from "fs/promises";
import { join } from "path";

export interface HarnessFeature {
  id: string;
  name: string;
  passes: boolean;
  priority: number;
}

export interface HarnessInfo {
  version: string | null;
  memoryVersion: number;
  memory: {
    failures: number;
    successes: number;
    decisions: number;
    rules: number;
  };
  loop: {
    status: string;
    feature: string | null;
    attempt: number;
    maxAttempts: number;
  };
  workingContext: {
    compiledAt: string | null;
    sessionId: string | null;
    lastStopEvent: string | null;
  };
  features: {
    count: number;
    active: HarnessFeature | null;
    list: HarnessFeature[];
  };
}

// Helper to read JSON file
async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Check if harness is available
export async function isHarnessAvailable(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, ".claude-harness"));
    return true;
  } catch {
    return false;
  }
}

// Get harness info
export async function getHarnessInfo(cwd: string): Promise<HarnessInfo | null> {
  const harnessDir = join(cwd, ".claude-harness");

  if (!await isHarnessAvailable(cwd)) return null;

  // Read plugin version
  let version: string | null = null;
  try {
    const content = await readFile(join(harnessDir, ".plugin-version"), "utf-8");
    version = content.trim();
  } catch {}

  // Count entries in JSON files - handles different array key names
  const countArrayEntries = async (file: string, ...keys: string[]): Promise<number> => {
    const data = await readJsonFile<Record<string, unknown[]>>(file);
    if (!data) return 0;
    for (const key of keys) {
      if (Array.isArray(data[key])) {
        return data[key].length;
      }
    }
    return 0;
  };

  const failures = await countArrayEntries(
    join(harnessDir, "memory/procedural/failures.json"),
    "entries", "failures"
  );
  const successes = await countArrayEntries(
    join(harnessDir, "memory/procedural/successes.json"),
    "entries", "successes"
  );
  const decisions = await countArrayEntries(
    join(harnessDir, "memory/episodic/decisions.json"),
    "decisions", "entries"
  );

  // Get rules count
  const rulesData = await readJsonFile<{ rules?: { active?: boolean }[] }>(
    join(harnessDir, "memory/learned/rules.json")
  );
  const rules = rulesData?.rules?.filter(r => r.active)?.length ?? 0;

  // Get loop state
  const loopState = await readJsonFile<{
    status?: string;
    feature?: string;
    attempt?: number;
    maxAttempts?: number;
  }>(join(harnessDir, "loop-state.json"));

  // Get working context
  const workingCtx = await readJsonFile<{
    version?: number;
    computedAt?: string;
    sessionId?: string;
    lastStopEvent?: string;
  }>(join(harnessDir, "memory/working/context.json"));

  // Get feature list
  const featureData = await readJsonFile<{
    features?: {
      id: string;
      name: string;
      passes?: boolean;
      priority?: number;
    }[];
  }>(join(harnessDir, "feature-list.json"));

  const featureList: HarnessFeature[] = (featureData?.features ?? []).map(f => ({
    id: f.id,
    name: f.name,
    passes: f.passes ?? false,
    priority: f.priority ?? 0,
  }));

  const activeFeatureId = loopState?.feature;
  const activeFeature = activeFeatureId
    ? featureList.find(f => f.id === activeFeatureId) ?? null
    : null;

  return {
    version,
    memoryVersion: workingCtx?.version ?? 0,
    memory: { failures, successes, decisions, rules },
    loop: {
      status: loopState?.status ?? "idle",
      feature: loopState?.feature ?? null,
      attempt: loopState?.attempt ?? 0,
      maxAttempts: loopState?.maxAttempts ?? 10,
    },
    workingContext: {
      compiledAt: workingCtx?.computedAt ?? null,
      sessionId: workingCtx?.sessionId ?? null,
      lastStopEvent: workingCtx?.lastStopEvent ?? null,
    },
    features: {
      count: featureList.length,
      active: activeFeature,
      list: featureList,
    },
  };
}
