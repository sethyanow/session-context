// Handoff data structure
export interface HandoffFile {
  path: string;
  role: string;
}

export interface UserDecision {
  question: string;
  answer: string;
  timestamp: string;
}

export interface PlanCache {
  path: string;
  cachedAt: string;
  content: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface HandoffContext {
  task: string;
  summary: string;
  state: "in_progress" | "blocked" | "ready_for_review" | "completed";
  files: HandoffFile[];
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  userDecisions: UserDecision[];
  plan?: PlanCache;
}

export interface HandoffReferences {
  claudeMemIds?: number[];
  beadsIssue?: string;
  harnessFeature?: string;
}

export interface Handoff {
  id: string;
  version: number;
  created: string;
  updated: string;
  ttl: string;

  project: {
    root: string;
    hash: string;
    branch: string;
  };

  context: HandoffContext;
  todos: TodoItem[];
  references: HandoffReferences;
}

// MCP tool params
export interface GetSessionStatusParams {
  level?: "minimal" | "standard" | "full";
  also?: string[];
  just?: string[];
  handoff?: string;
  autoRecover?: boolean;
}

export interface CreateHandoffParams {
  task: string;
  summary?: string;
  nextSteps?: string[];
  decisions?: string[];
  includeClaudeMemRecent?: number;
}

export interface UpdateCheckpointParams {
  files?: HandoffFile[];
  task?: string;
  todos?: TodoItem[];
  plan?: { path: string; content: string };
  userDecision?: { question: string; answer: string };
}

// Integration detection results
export interface IntegrationStatus {
  claudeMem: boolean;
  beads: boolean;
  harness: boolean;
  agentMail: boolean;
}

// Config
export interface SessionContextConfig {
  version: number;
  tracking: {
    enabled: boolean;
    trackEdits: boolean;
    trackTodos: boolean;
    trackPlans: boolean;
    trackUserDecisions: boolean;
  };
  checkpoints: {
    rollingEnabled: boolean;
    rollingMaxAge: string;
    explicitTTL: string;
    maxStoredHandoffs: number;
  };
  recovery: {
    autoRecover: boolean;
    offerCheckpointRestore: boolean;
    silentMarkerRecovery: boolean;
  };
  marker: {
    style: "hidden" | "visible" | "none";
    frequency: "on_significant_edit" | "every_response" | "manual";
  };
  integrations: {
    claudeMem: "auto" | "enabled" | "disabled";
    beads: "auto" | "enabled" | "disabled";
    harness: "auto" | "enabled" | "disabled";
    agentMail: "auto" | "enabled" | "disabled";
  };
  privacy: {
    excludePatterns: string[];
  };
}
