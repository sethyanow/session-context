import { join } from "node:path";

export interface HarnessFeature {
  id: string;
  name: string;
  passes: boolean;
  priority: number;
}

// v3.0 Memory Architecture types
export interface HarnessDecision {
  id: string;
  timestamp: string;
  feature: string;
  decision: string;
}

export interface HarnessLearnedRule {
  id: string;
  title: string;
  description: string;
  scope: string;
}

export interface HarnessVerification {
  build?: { status: string; timestamp?: string };
  tests?: { status: string; timestamp?: string };
  lint?: { status: string; timestamp?: string };
  typecheck?: { status: string; timestamp?: string };
}

export interface HarnessTDD {
  enabled: boolean;
  phase: string | null; // "red" | "green" | "refactor" | null
  testsWritten: string[];
  testStatus: string | null; // "failing" | "passing" | null
}

export interface HarnessLoopHistory {
  attempt: number;
  approach: string;
  result: string;
}

export interface HarnessInfo {
  version: string | null;
  memoryVersion: number;
  memory: {
    // Counts (backward compat)
    failures: number;
    successes: number;
    decisions: number;
    rules: number;
    // Actual content (v3.0)
    recentDecisions: HarnessDecision[];
    projectPatterns: string[];
    avoidApproaches: string[];
    learnedRules: HarnessLearnedRule[];
  };
  loop: {
    status: string;
    feature: string | null;
    featureName: string | null;
    type: string; // "feature" | "fix"
    linkedTo: { featureId: string | null; featureName: string | null } | null;
    attempt: number;
    maxAttempts: number;
    verification: HarnessVerification;
    tdd: HarnessTDD | null;
    history: HarnessLoopHistory[];
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

// Helper to read JSON file using Bun APIs
async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return (await file.json()) as T;
  } catch {
    return null;
  }
}

// Check if harness is available using Bun APIs
export async function isHarnessAvailable(cwd: string): Promise<boolean> {
  try {
    // Use Bun.spawn to check if directory exists (Bun.file() is for files, not directories)
    const proc = Bun.spawn(["test", "-d", join(cwd, ".claude-harness")]);
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

// Payload size limits to prevent bloated responses
const LIMITS = {
  recentDecisions: 5,
  projectPatterns: 10,
  avoidApproaches: 5,
  learnedRules: 10,
  history: 5,
} as const;

// Get harness info
export async function getHarnessInfo(cwd: string): Promise<HarnessInfo | null> {
  const harnessDir = join(cwd, ".claude-harness");

  if (!(await isHarnessAvailable(cwd))) return null;

  // Read plugin version using Bun APIs
  let version: string | null = null;
  try {
    const versionFile = Bun.file(join(harnessDir, ".plugin-version"));
    if (await versionFile.exists()) {
      version = (await versionFile.text()).trim();
    }
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
    "entries",
    "failures",
  );
  const successes = await countArrayEntries(
    join(harnessDir, "memory/procedural/successes.json"),
    "entries",
    "successes",
  );
  const decisions = await countArrayEntries(
    join(harnessDir, "memory/episodic/decisions.json"),
    "decisions",
    "entries",
  );

  // Get rules count and active rules
  const rulesData = await readJsonFile<{
    rules?: { id?: string; title?: string; description?: string; scope?: string; active?: boolean }[];
  }>(join(harnessDir, "memory/learned/rules.json"));
  const activeRules = rulesData?.rules?.filter((r) => r.active) ?? [];
  const rules = activeRules.length;

  // Loop state type (v3.0 and legacy combined)
  interface LoopStateData {
    version?: number;
    status?: string;
    feature?: string;
    featureName?: string;
    type?: string;
    linkedTo?: { featureId?: string | null; featureName?: string | null };
    attempt?: number;
    maxAttempts?: number;
    verification?: HarnessVerification;
    tdd?: {
      enabled?: boolean;
      phase?: string | null;
      testsWritten?: string[];
      testStatus?: string | null;
    };
    history?: Array<{ attempt?: number; approach?: string; result?: string }>;
  }

  // Get loop state - try v3.0 path first, fallback to legacy
  const loopState: LoopStateData | null =
    (await readJsonFile<LoopStateData>(join(harnessDir, "loops/state.json"))) ??
    (await readJsonFile<LoopStateData>(join(harnessDir, "loop-state.json")));

  // Get working context with relevantMemory (v3.0)
  const workingCtx = await readJsonFile<{
    version?: number;
    computedAt?: string;
    sessionId?: string;
    lastStopEvent?: string;
    relevantMemory?: {
      recentDecisions?: Array<{
        id?: string;
        timestamp?: string;
        feature?: string;
        decision?: string;
      }>;
      projectPatterns?: string[];
      avoidApproaches?: string[];
      learnedRules?: Array<{
        id?: string;
        title?: string;
        description?: string;
        scope?: string;
      }>;
    };
  }>(join(harnessDir, "memory/working/context.json"));

  // Extract relevantMemory with limits
  const relevantMemory = workingCtx?.relevantMemory;
  const recentDecisions: HarnessDecision[] = (relevantMemory?.recentDecisions ?? [])
    .slice(0, LIMITS.recentDecisions)
    .map((d) => ({
      id: d.id ?? "",
      timestamp: d.timestamp ?? "",
      feature: d.feature ?? "",
      decision: d.decision ?? "",
    }));
  const projectPatterns = (relevantMemory?.projectPatterns ?? []).slice(0, LIMITS.projectPatterns);
  const avoidApproaches = (relevantMemory?.avoidApproaches ?? []).slice(0, LIMITS.avoidApproaches);
  const learnedRules: HarnessLearnedRule[] = (relevantMemory?.learnedRules ?? activeRules)
    .slice(0, LIMITS.learnedRules)
    .map((r) => ({
      id: r.id ?? "",
      title: r.title ?? "",
      description: r.description ?? "",
      scope: r.scope ?? "",
    }));

  // Get feature list - try v3.0 active.json first, fallback to feature-list.json
  const activeFeatureData = await readJsonFile<{
    id?: string;
    name?: string;
    passes?: boolean;
    priority?: number;
  }>(join(harnessDir, "features/active.json"));

  const featureData = await readJsonFile<{
    features?: {
      id: string;
      name: string;
      passes?: boolean;
      priority?: number;
    }[];
  }>(join(harnessDir, "feature-list.json"));

  const featureList: HarnessFeature[] = (featureData?.features ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    passes: f.passes ?? false,
    priority: f.priority ?? 0,
  }));

  // Determine active feature from loop state or active.json
  const activeFeatureId = loopState?.feature ?? activeFeatureData?.id;
  const activeFeature = activeFeatureId
    ? activeFeatureData?.id === activeFeatureId
      ? {
          id: activeFeatureData.id ?? "",
          name: activeFeatureData.name ?? "",
          passes: activeFeatureData.passes ?? false,
          priority: activeFeatureData.priority ?? 0,
        }
      : (featureList.find((f) => f.id === activeFeatureId) ?? null)
    : null;

  // Extract TDD state if present
  const tdd: HarnessTDD | null = loopState?.tdd
    ? {
        enabled: loopState.tdd.enabled ?? false,
        phase: loopState.tdd.phase ?? null,
        testsWritten: loopState.tdd.testsWritten ?? [],
        testStatus: loopState.tdd.testStatus ?? null,
      }
    : null;

  // Extract history with limit
  const history: HarnessLoopHistory[] = (loopState?.history ?? [])
    .slice(0, LIMITS.history)
    .map((h) => ({
      attempt: h.attempt ?? 0,
      approach: h.approach ?? "",
      result: h.result ?? "",
    }));

  return {
    version,
    memoryVersion: workingCtx?.version ?? 0,
    memory: {
      failures,
      successes,
      decisions,
      rules,
      recentDecisions,
      projectPatterns,
      avoidApproaches,
      learnedRules,
    },
    loop: {
      status: loopState?.status ?? "idle",
      feature: loopState?.feature ?? null,
      featureName: loopState?.featureName ?? null,
      type: loopState?.type ?? "feature",
      linkedTo: loopState?.linkedTo
        ? {
            featureId: loopState.linkedTo.featureId ?? null,
            featureName: loopState.linkedTo.featureName ?? null,
          }
        : null,
      attempt: loopState?.attempt ?? 0,
      maxAttempts: loopState?.maxAttempts ?? 10,
      verification: loopState?.verification ?? {},
      tdd,
      history,
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
