import { describe, expect, test } from "bun:test";
import {
  buildContinuationPrompt,
  type PromptContext,
} from "../utils/prompt-builder.js";
import { generateSessionName } from "../utils/agent-deck.js";

describe("spawn-session", () => {
  describe("generateSessionName", () => {
    test("generates name from task and handoff ID", () => {
      const name = generateSessionName("Implement user authentication", "abc12");
      expect(name).toBe("implement-user-authentication-abc12");
    });

    test("limits to 3 words from task", () => {
      const name = generateSessionName(
        "Add new feature for user profile settings page",
        "xyz89",
      );
      expect(name).toBe("add-new-feature-xyz89");
    });

    test("filters out short words", () => {
      const name = generateSessionName("Fix a bug in the API", "def34");
      expect(name).toBe("fix-bug-the-def34");
    });

    test("removes special characters", () => {
      const name = generateSessionName("Fix bug #123 (urgent!)", "ghi56");
      expect(name).toBe("fix-bug-123-ghi56");
    });

    test("handles empty task gracefully", () => {
      const name = generateSessionName("", "jkl78");
      expect(name).toBe("session-jkl78");
    });

    test("handles task with only short words", () => {
      const name = generateSessionName("a b c", "mno90");
      expect(name).toBe("session-mno90");
    });
  });

  describe("buildContinuationPrompt", () => {
    test("builds minimal prompt with just task and handoff info", () => {
      const ctx: PromptContext = {
        task: "Implement user authentication",
        handoffId: "abc12",
        projectRoot: "/Volumes/code/myproject",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("# Continuing: Implement user authentication");
      expect(prompt).toContain("Handoff: abc12");
      expect(prompt).toContain("Project: /Volumes/code/myproject");
    });

    test("includes summary when provided", () => {
      const ctx: PromptContext = {
        task: "Add dark mode",
        summary: "Implemented theme context and toggle button",
        handoffId: "xyz89",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("## Summary");
      expect(prompt).toContain("Implemented theme context and toggle button");
    });

    test("includes completed section when provided", () => {
      const ctx: PromptContext = {
        task: "Refactor API",
        completed: "Migrated 5 endpoints to new pattern",
        handoffId: "def34",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("## What was done");
      expect(prompt).toContain("Migrated 5 endpoints to new pattern");
    });

    test("includes numbered next steps", () => {
      const ctx: PromptContext = {
        task: "Database migration",
        nextSteps: ["Run migration script", "Verify data integrity", "Update docs"],
        handoffId: "ghi56",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("## What's next");
      expect(prompt).toContain("1. Run migration script");
      expect(prompt).toContain("2. Verify data integrity");
      expect(prompt).toContain("3. Update docs");
    });

    test("includes files with roles (limited to 10)", () => {
      const ctx: PromptContext = {
        task: "Code review",
        files: [
          { path: "/src/auth.ts", role: "modified" },
          { path: "/src/api.ts", role: "created" },
          { path: "/README.md", role: "read" },
        ],
        handoffId: "jkl78",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("## Key files");
      expect(prompt).toContain("- /src/auth.ts (modified)");
      expect(prompt).toContain("- /src/api.ts (created)");
      expect(prompt).toContain("- /README.md (read)");
    });

    test("limits files to 10", () => {
      const files = Array.from({ length: 15 }, (_, i) => ({
        path: `/src/file${i}.ts`,
        role: "modified",
      }));

      const ctx: PromptContext = {
        task: "Large refactor",
        files,
        handoffId: "mno90",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      // Should only include first 10
      expect(prompt).toContain("file9.ts");
      expect(prompt).not.toContain("file10.ts");
    });

    test("includes only pending/in_progress todos (limited to 5)", () => {
      const ctx: PromptContext = {
        task: "Feature work",
        todos: [
          { content: "Completed task", status: "completed" },
          { content: "In progress task", status: "in_progress" },
          { content: "Pending task 1", status: "pending" },
          { content: "Pending task 2", status: "pending" },
        ],
        handoffId: "pqr12",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("## Pending todos");
      expect(prompt).toContain("- [ ] In progress task");
      expect(prompt).toContain("- [ ] Pending task 1");
      expect(prompt).toContain("- [ ] Pending task 2");
      expect(prompt).not.toContain("Completed task");
    });

    test("limits todos to 5", () => {
      const todos = Array.from({ length: 10 }, (_, i) => ({
        content: `Todo ${i}`,
        status: "pending" as const,
      }));

      const ctx: PromptContext = {
        task: "Many todos",
        todos,
        handoffId: "stu34",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).toContain("Todo 4");
      expect(prompt).not.toContain("Todo 5");
    });

    test("builds full prompt with all fields", () => {
      const ctx: PromptContext = {
        task: "Implement OAuth login",
        summary: "Adding Google OAuth to the app",
        completed: "Set up passport.js and configured providers",
        nextSteps: ["Add callback routes", "Create session middleware"],
        files: [
          { path: "/src/auth/oauth.ts", role: "created" },
          { path: "/src/config.ts", role: "modified" },
        ],
        todos: [
          { content: "Add Google callback", status: "in_progress" },
          { content: "Add GitHub callback", status: "pending" },
        ],
        handoffId: "vwx56",
        projectRoot: "/Volumes/code/myapp",
      };

      const prompt = buildContinuationPrompt(ctx);

      // Verify structure
      expect(prompt).toContain("# Continuing: Implement OAuth login");
      expect(prompt).toContain("## Summary");
      expect(prompt).toContain("## What was done");
      expect(prompt).toContain("## What's next");
      expect(prompt).toContain("## Key files");
      expect(prompt).toContain("## Pending todos");
      expect(prompt).toContain("---");
      expect(prompt).toContain("Handoff: vwx56 | Project: /Volumes/code/myapp");
    });

    test("omits empty sections", () => {
      const ctx: PromptContext = {
        task: "Minimal task",
        handoffId: "yza78",
        projectRoot: "/project",
      };

      const prompt = buildContinuationPrompt(ctx);

      expect(prompt).not.toContain("## Summary");
      expect(prompt).not.toContain("## What was done");
      expect(prompt).not.toContain("## What's next");
      expect(prompt).not.toContain("## Key files");
      expect(prompt).not.toContain("## Pending todos");
    });
  });
});
