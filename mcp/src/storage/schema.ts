/**
 * Schema validation for handoff data
 *
 * Provides validation functions to ensure handoff data is well-formed
 * before processing, preventing crashes from malformed data.
 */

import type { Handoff } from "../types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: Handoff;
}

/**
 * Validate a handoff object parsed from JSON
 * Returns validation result with errors list and sanitized data if valid
 */
export function validateHandoff(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Data is not an object"] };
  }

  const obj = data as Record<string, unknown>;

  // Required top-level fields
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push("Missing or invalid 'id'");
  }

  if (typeof obj.version !== "number") {
    errors.push("Missing or invalid 'version'");
  }

  // Version compatibility check
  if (typeof obj.version === "number" && obj.version > 1) {
    errors.push(`Unsupported schema version: ${obj.version}`);
  }

  if (typeof obj.created !== "string") {
    errors.push("Missing or invalid 'created'");
  }

  if (typeof obj.updated !== "string") {
    errors.push("Missing or invalid 'updated'");
  }

  if (typeof obj.ttl !== "string") {
    errors.push("Missing or invalid 'ttl'");
  }

  // Project object validation
  if (!obj.project || typeof obj.project !== "object") {
    errors.push("Missing or invalid 'project'");
  } else {
    const project = obj.project as Record<string, unknown>;
    if (typeof project.root !== "string") {
      errors.push("Missing or invalid 'project.root'");
    }
    if (typeof project.hash !== "string") {
      errors.push("Missing or invalid 'project.hash'");
    }
    if (typeof project.branch !== "string") {
      errors.push("Missing or invalid 'project.branch'");
    }
  }

  // Context object validation
  if (!obj.context || typeof obj.context !== "object") {
    errors.push("Missing or invalid 'context'");
  } else {
    const context = obj.context as Record<string, unknown>;
    if (typeof context.task !== "string") {
      errors.push("Missing or invalid 'context.task'");
    }
    if (typeof context.state !== "string") {
      errors.push("Missing or invalid 'context.state'");
    }
    if (!Array.isArray(context.files)) {
      errors.push("Missing or invalid 'context.files'");
    }
    if (!Array.isArray(context.decisions)) {
      errors.push("Missing or invalid 'context.decisions'");
    }
    if (!Array.isArray(context.blockers)) {
      errors.push("Missing or invalid 'context.blockers'");
    }
    if (!Array.isArray(context.nextSteps)) {
      errors.push("Missing or invalid 'context.nextSteps'");
    }
    if (!Array.isArray(context.userDecisions)) {
      errors.push("Missing or invalid 'context.userDecisions'");
    }
  }

  // Todos array validation
  if (!Array.isArray(obj.todos)) {
    errors.push("Missing or invalid 'todos'");
  }

  // References object validation
  if (obj.references !== undefined && typeof obj.references !== "object") {
    errors.push("Invalid 'references' - must be an object");
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? (data as Handoff) : undefined,
  };
}

/**
 * Check if data looks like a handoff (for quick filtering)
 * Less strict than validateHandoff - just checks for key identifying fields
 */
export function looksLikeHandoff(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.version === "number" &&
    obj.project !== undefined &&
    obj.context !== undefined
  );
}
