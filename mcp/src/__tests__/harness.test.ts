import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("harness integration", () => {
  let testDir: string;
  let harnessDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test using Bun APIs
    const tmpBase = Bun.env.TMPDIR || "/tmp";
    testDir = join(tmpBase, `harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    harnessDir = join(testDir, ".claude-harness");
    // Create the test directory
    await Bun.write(join(testDir, ".keep"), "");
  });

  afterEach(async () => {
    // Clean up using Bun.spawn
    try {
      const proc = Bun.spawn(["rm", "-rf", testDir]);
      await proc.exited;
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("isHarnessAvailable", () => {
    test("returns false when .claude-harness directory does not exist", async () => {
      const { isHarnessAvailable } = await import("../integrations/harness");
      const result = await isHarnessAvailable(testDir);
      expect(result).toBe(false);
    });

    test("returns true when .claude-harness directory exists", async () => {
      // Create the harness directory with a file inside
      await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
      const { isHarnessAvailable } = await import("../integrations/harness");
      const result = await isHarnessAvailable(testDir);
      expect(result).toBe(true);
    });
  });

  describe("getHarnessInfo", () => {
    test("returns null when harness not available", async () => {
      const { getHarnessInfo } = await import("../integrations/harness");
      const result = await getHarnessInfo(testDir);
      expect(result).toBe(null);
    });

    test("returns basic structure with minimal harness setup", async () => {
      // Create minimal harness structure
      await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");

      const { getHarnessInfo } = await import("../integrations/harness");
      const result = await getHarnessInfo(testDir);

      expect(result).not.toBeNull();
      expect(result!.version).toBe("3.7.1");
      expect(result!.memory).toBeDefined();
      expect(result!.loop).toBeDefined();
      expect(result!.features).toBeDefined();
      expect(result!.workingContext).toBeDefined();
    });

    test("reads plugin version correctly", async () => {
      await Bun.write(join(harnessDir, ".plugin-version"), "3.7.2");

      const { getHarnessInfo } = await import("../integrations/harness");
      const result = await getHarnessInfo(testDir);

      expect(result!.version).toBe("3.7.2");
    });

    describe("memory counts", () => {
      test("counts failures from memory/procedural/failures.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/procedural/failures.json"),
          JSON.stringify({
            entries: [
              { id: "f1", approach: "approach1", rootCause: "cause1" },
              { id: "f2", approach: "approach2", rootCause: "cause2" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.failures).toBe(2);
      });

      test("counts successes from memory/procedural/successes.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/procedural/successes.json"),
          JSON.stringify({
            entries: [
              { id: "s1", pattern: "pattern1" },
              { id: "s2", pattern: "pattern2" },
              { id: "s3", pattern: "pattern3" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.successes).toBe(3);
      });

      test("counts decisions from memory/episodic/decisions.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/episodic/decisions.json"),
          JSON.stringify({
            decisions: [
              { id: "d1", decision: "decision1" },
              { id: "d2", decision: "decision2" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.decisions).toBe(2);
      });

      test("counts only active rules from memory/learned/rules.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/learned/rules.json"),
          JSON.stringify({
            rules: [
              { id: "r1", active: true, title: "Rule 1" },
              { id: "r2", active: false, title: "Rule 2" },
              { id: "r3", active: true, title: "Rule 3" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.rules).toBe(2);
      });

      test("handles missing memory files gracefully", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.failures).toBe(0);
        expect(result!.memory.successes).toBe(0);
        expect(result!.memory.decisions).toBe(0);
        expect(result!.memory.rules).toBe(0);
      });
    });

    describe("v3.0 loop state", () => {
      test("reads loop state from v3.0 path loops/state.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            version: 3,
            status: "in_progress",
            feature: "feature-001",
            featureName: "Add authentication",
            type: "feature",
            attempt: 2,
            maxAttempts: 10,
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.status).toBe("in_progress");
        expect(result!.loop.feature).toBe("feature-001");
        expect(result!.loop.featureName).toBe("Add authentication");
        expect(result!.loop.type).toBe("feature");
        expect(result!.loop.attempt).toBe(2);
        expect(result!.loop.maxAttempts).toBe(10);
      });

      test("falls back to legacy loop-state.json when v3.0 path missing", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loop-state.json"),
          JSON.stringify({
            status: "idle",
            feature: null,
            attempt: 0,
            maxAttempts: 5,
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.status).toBe("idle");
        expect(result!.loop.feature).toBeNull();
        expect(result!.loop.maxAttempts).toBe(5);
      });

      test("reads linkedTo for fix type", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            feature: "fix-feature-001-001",
            type: "fix",
            linkedTo: {
              featureId: "feature-001",
              featureName: "Add authentication",
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.type).toBe("fix");
        expect(result!.loop.linkedTo).not.toBeNull();
        expect(result!.loop.linkedTo!.featureId).toBe("feature-001");
        expect(result!.loop.linkedTo!.featureName).toBe("Add authentication");
      });

      test("defaults loop type to 'feature' when not specified", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.type).toBe("feature");
      });
    });

    describe("TDD state extraction", () => {
      test("extracts TDD state when present", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            feature: "feature-001",
            tdd: {
              enabled: true,
              phase: "green",
              testsWritten: ["test1.ts", "test2.ts"],
              testStatus: "passing",
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.tdd).not.toBeNull();
        expect(result!.loop.tdd!.enabled).toBe(true);
        expect(result!.loop.tdd!.phase).toBe("green");
        expect(result!.loop.tdd!.testsWritten).toEqual(["test1.ts", "test2.ts"]);
        expect(result!.loop.tdd!.testStatus).toBe("passing");
      });

      test("returns null TDD state when not present", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.tdd).toBeNull();
      });

      test("handles partial TDD state with defaults", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            tdd: {
              enabled: true,
              // Missing other fields
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.tdd).not.toBeNull();
        expect(result!.loop.tdd!.enabled).toBe(true);
        expect(result!.loop.tdd!.phase).toBeNull();
        expect(result!.loop.tdd!.testsWritten).toEqual([]);
        expect(result!.loop.tdd!.testStatus).toBeNull();
      });
    });

    describe("loop history extraction", () => {
      test("extracts history from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            history: [
              { attempt: 1, approach: "Direct implementation", result: "failed" },
              { attempt: 2, approach: "TDD approach", result: "passed" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.history).toHaveLength(2);
        expect(result!.loop.history[0].attempt).toBe(1);
        expect(result!.loop.history[0].approach).toBe("Direct implementation");
        expect(result!.loop.history[0].result).toBe("failed");
      });

      test("limits history to 5 entries", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        const manyHistory = Array.from({ length: 10 }, (_, i) => ({
          attempt: i + 1,
          approach: `Approach ${i + 1}`,
          result: "failed",
        }));
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            history: manyHistory,
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.history).toHaveLength(5);
        expect(result!.loop.history[0].attempt).toBe(1);
        expect(result!.loop.history[4].attempt).toBe(5);
      });

      test("returns empty history when not present", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.history).toEqual([]);
      });
    });

    describe("relevantMemory extraction from working context", () => {
      test("extracts recentDecisions from relevantMemory", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            computedAt: "2026-02-05T10:00:00Z",
            relevantMemory: {
              recentDecisions: [
                { id: "d1", timestamp: "2026-02-05T09:00:00Z", feature: "f1", decision: "Use TDD" },
                { id: "d2", timestamp: "2026-02-05T09:30:00Z", feature: "f1", decision: "Add tests first" },
              ],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.recentDecisions).toHaveLength(2);
        expect(result!.memory.recentDecisions[0].id).toBe("d1");
        expect(result!.memory.recentDecisions[0].decision).toBe("Use TDD");
      });

      test("limits recentDecisions to 5 entries", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        const manyDecisions = Array.from({ length: 10 }, (_, i) => ({
          id: `d${i}`,
          timestamp: `2026-02-05T0${i}:00:00Z`,
          feature: "f1",
          decision: `Decision ${i}`,
        }));
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: { recentDecisions: manyDecisions },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.recentDecisions).toHaveLength(5);
      });

      test("extracts projectPatterns from relevantMemory", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: {
              projectPatterns: ["Use bun for tests", "Prefer async/await"],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.projectPatterns).toEqual(["Use bun for tests", "Prefer async/await"]);
      });

      test("limits projectPatterns to 10 entries", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        const manyPatterns = Array.from({ length: 15 }, (_, i) => `Pattern ${i}`);
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: { projectPatterns: manyPatterns },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.projectPatterns).toHaveLength(10);
      });

      test("extracts avoidApproaches from relevantMemory", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: {
              avoidApproaches: ["Don't use synchronous file APIs", "Avoid hardcoded paths"],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.avoidApproaches).toEqual([
          "Don't use synchronous file APIs",
          "Avoid hardcoded paths",
        ]);
      });

      test("limits avoidApproaches to 5 entries", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        const manyApproaches = Array.from({ length: 10 }, (_, i) => `Avoid ${i}`);
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: { avoidApproaches: manyApproaches },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.avoidApproaches).toHaveLength(5);
      });

      test("extracts learnedRules from relevantMemory", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: {
              learnedRules: [
                { id: "r1", title: "Use TDD", description: "Always write tests first", scope: "testing" },
              ],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.learnedRules).toHaveLength(1);
        expect(result!.memory.learnedRules[0].title).toBe("Use TDD");
      });

      test("falls back to active rules when relevantMemory.learnedRules not present", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/learned/rules.json"),
          JSON.stringify({
            rules: [
              { id: "r1", title: "Fallback Rule", description: "From rules.json", scope: "general", active: true },
            ],
          })
        );
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: {
              // No learnedRules field - should fall back to rules.json
              projectPatterns: [],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        // Should fall back to activeRules since relevantMemory.learnedRules is undefined
        expect(result!.memory.learnedRules).toHaveLength(1);
        expect(result!.memory.learnedRules[0].title).toBe("Fallback Rule");
      });

      test("respects explicit empty learnedRules (no fallback)", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/learned/rules.json"),
          JSON.stringify({
            rules: [
              { id: "r1", title: "Active Rule", description: "From rules.json", scope: "general", active: true },
            ],
          })
        );
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: {
              learnedRules: [], // Explicitly empty - this is intentional, no fallback
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        // Explicit empty array means "no rules apply" - don't fall back
        expect(result!.memory.learnedRules).toHaveLength(0);
      });

      test("limits learnedRules to 10 entries", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        const manyRules = Array.from({ length: 15 }, (_, i) => ({
          id: `r${i}`,
          title: `Rule ${i}`,
          description: `Description ${i}`,
          scope: "general",
        }));
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            relevantMemory: { learnedRules: manyRules },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.learnedRules).toHaveLength(10);
      });

      test("handles missing relevantMemory gracefully", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            computedAt: "2026-02-05T10:00:00Z",
            // No relevantMemory field
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.memory.recentDecisions).toEqual([]);
        expect(result!.memory.projectPatterns).toEqual([]);
        expect(result!.memory.avoidApproaches).toEqual([]);
      });
    });

    describe("working context extraction", () => {
      test("extracts computedAt from working context", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "memory/working/context.json"),
          JSON.stringify({
            computedAt: "2026-02-05T10:00:00Z",
            sessionId: "session-123",
            lastStopEvent: "2026-02-05T09:00:00Z",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.workingContext.compiledAt).toBe("2026-02-05T10:00:00Z");
        expect(result!.workingContext.sessionId).toBe("session-123");
        expect(result!.workingContext.lastStopEvent).toBe("2026-02-05T09:00:00Z");
      });

      test("handles missing working context file", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.workingContext.compiledAt).toBeNull();
        expect(result!.workingContext.sessionId).toBeNull();
        expect(result!.workingContext.lastStopEvent).toBeNull();
      });
    });

    describe("feature extraction", () => {
      test("reads features from v3.0 features/active.json (single feature format)", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "features/active.json"),
          JSON.stringify({
            id: "feature-001",
            name: "Add authentication",
            passes: false,
            priority: 1,
          })
        );
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            feature: "feature-001",
            status: "in_progress",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.features.active).not.toBeNull();
        expect(result!.features.active!.id).toBe("feature-001");
        expect(result!.features.active!.name).toBe("Add authentication");
      });

      test("reads features from legacy feature-list.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "feature-list.json"),
          JSON.stringify({
            features: [
              { id: "f1", name: "Feature 1", passes: true, priority: 1 },
              { id: "f2", name: "Feature 2", passes: false, priority: 2 },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.features.count).toBe(2);
        expect(result!.features.list).toHaveLength(2);
        expect(result!.features.list[0].id).toBe("f1");
      });

      test("returns active feature from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "feature-list.json"),
          JSON.stringify({
            features: [
              { id: "f1", name: "Feature 1", passes: true, priority: 1 },
              { id: "f2", name: "Feature 2", passes: false, priority: 2 },
            ],
          })
        );
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            feature: "f2",
            status: "in_progress",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.features.active).not.toBeNull();
        expect(result!.features.active!.id).toBe("f2");
        expect(result!.features.active!.name).toBe("Feature 2");
      });

      test("handles no active feature", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            feature: null,
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.features.active).toBeNull();
      });
    });

    describe("verification state", () => {
      test("extracts verification state from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            verification: {
              build: { status: "passing", timestamp: "2026-02-05T10:00:00Z" },
              tests: { status: "passing", timestamp: "2026-02-05T10:01:00Z" },
              lint: { status: "failing", timestamp: "2026-02-05T10:02:00Z" },
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.verification.build?.status).toBe("passing");
        expect(result!.loop.verification.tests?.status).toBe("passing");
        expect(result!.loop.verification.lint?.status).toBe("failing");
      });

      test("returns empty verification when not present", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.verification).toEqual({});
      });
    });

    describe("v4.4.2 loop timing fields", () => {
      test("extracts startedAt from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            startedAt: "2026-02-07T10:00:00Z",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing).toBeDefined();
        expect(result!.loop.timing?.startedAt).toBe("2026-02-07T10:00:00Z");
      });

      test("extracts lastAttemptAt from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            lastAttemptAt: "2026-02-07T11:30:00Z",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing?.lastAttemptAt).toBe("2026-02-07T11:30:00Z");
      });

      test("extracts lastCheckpoint from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            lastCheckpoint: "2026-02-07T11:00:00Z",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing?.lastCheckpoint).toBe("2026-02-07T11:00:00Z");
      });

      test("extracts escalationRequested from loop state", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            escalationRequested: true,
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing?.escalationRequested).toBe(true);
      });

      test("handles missing timing fields gracefully", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "idle",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing).toBeNull();
      });

      test("extracts all timing fields together", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "loops/state.json"),
          JSON.stringify({
            status: "in_progress",
            startedAt: "2026-02-07T10:00:00Z",
            lastAttemptAt: "2026-02-07T11:30:00Z",
            lastCheckpoint: "2026-02-07T11:00:00Z",
            escalationRequested: false,
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.loop.timing).toEqual({
          startedAt: "2026-02-07T10:00:00Z",
          lastAttemptAt: "2026-02-07T11:30:00Z",
          lastCheckpoint: "2026-02-07T11:00:00Z",
          escalationRequested: false,
        });
      });
    });

    describe("v4.4.2 agent memory fields", () => {
      test("extracts learnedPatterns from agent-memory.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "agent-memory.json"),
          JSON.stringify({
            learnedPatterns: [
              { id: "p1", pattern: "Use TDD approach", successRate: 0.9 },
              { id: "p2", pattern: "Test edge cases", successRate: 0.85 },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory).toBeDefined();
        expect(result!.agentMemory?.learnedPatterns).toHaveLength(2);
        expect(result!.agentMemory?.learnedPatterns?.[0].pattern).toBe("Use TDD approach");
      });

      test("extracts successfulApproaches from agent-memory.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "agent-memory.json"),
          JSON.stringify({
            successfulApproaches: [
              { approach: "Direct implementation", uses: 5 },
              { approach: "Refactoring first", uses: 3 },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory?.successfulApproaches).toHaveLength(2);
        expect(result!.agentMemory?.successfulApproaches?.[0].approach).toBe("Direct implementation");
      });

      test("extracts failedApproaches from agent-memory.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "agent-memory.json"),
          JSON.stringify({
            failedApproaches: [
              { approach: "Quick fix", reason: "Incomplete" },
              { approach: "Skip tests", reason: "Breaking changes" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory?.failedApproaches).toHaveLength(2);
        expect(result!.agentMemory?.failedApproaches?.[0].approach).toBe("Quick fix");
      });

      test("extracts agentPerformance from agent-memory.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "agent-memory.json"),
          JSON.stringify({
            agentPerformance: {
              totalTasks: 50,
              successfulTasks: 45,
              avgTaskDuration: 300,
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory?.agentPerformance).toBeDefined();
        expect(result!.agentMemory?.agentPerformance?.totalTasks).toBe(50);
        expect(result!.agentMemory?.agentPerformance?.successfulTasks).toBe(45);
      });

      test("extracts codebaseInsights from agent-memory.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "agent-memory.json"),
          JSON.stringify({
            codebaseInsights: {
              hotspots: ["src/auth.ts", "src/database.ts"],
              patterns: ["Heavy use of async/await", "Frequent file I/O"],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory?.codebaseInsights).toBeDefined();
        expect(result!.agentMemory?.codebaseInsights?.hotspots).toEqual(["src/auth.ts", "src/database.ts"]);
      });

      test("handles missing agent-memory.json gracefully", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.agentMemory).toBeNull();
      });
    });

    describe("v4.4.2 root working context fields", () => {
      test("extracts summary from root working-context.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "working-context.json"),
          JSON.stringify({
            summary: "Currently implementing authentication feature",
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext).toBeDefined();
        expect(result!.rootWorkingContext?.summary).toBe("Currently implementing authentication feature");
      });

      test("extracts workingFiles from root working-context.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "working-context.json"),
          JSON.stringify({
            workingFiles: [
              { path: "src/auth.ts", role: "implementation" },
              { path: "tests/auth.test.ts", role: "tests" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext?.workingFiles).toHaveLength(2);
        expect(result!.rootWorkingContext?.workingFiles?.[0].path).toBe("src/auth.ts");
      });

      test("extracts decisions from root working-context.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "working-context.json"),
          JSON.stringify({
            decisions: [
              { id: "d1", decision: "Use JWT for authentication", timestamp: "2026-02-07T10:00:00Z" },
              { id: "d2", decision: "Implement rate limiting", timestamp: "2026-02-07T10:30:00Z" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext?.decisions).toHaveLength(2);
        expect(result!.rootWorkingContext?.decisions?.[0].decision).toBe("Use JWT for authentication");
      });

      test("extracts codebaseUnderstanding from root working-context.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "working-context.json"),
          JSON.stringify({
            codebaseUnderstanding: {
              architecture: "MVC pattern with services layer",
              keyDependencies: ["express", "typescript", "prisma"],
            },
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext?.codebaseUnderstanding).toBeDefined();
        expect(result!.rootWorkingContext?.codebaseUnderstanding?.architecture).toBe("MVC pattern with services layer");
      });

      test("extracts nextSteps from root working-context.json", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");
        await Bun.write(
          join(harnessDir, "working-context.json"),
          JSON.stringify({
            nextSteps: [
              { step: 1, action: "Write tests for login", priority: "high" },
              { step: 2, action: "Implement session management", priority: "medium" },
            ],
          })
        );

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext?.nextSteps).toHaveLength(2);
        expect(result!.rootWorkingContext?.nextSteps?.[0].action).toBe("Write tests for login");
      });

      test("handles missing root working-context.json gracefully", async () => {
        await Bun.write(join(harnessDir, ".plugin-version"), "3.7.1");

        const { getHarnessInfo } = await import("../integrations/harness");
        const result = await getHarnessInfo(testDir);

        expect(result!.rootWorkingContext).toBeNull();
      });
    });
  });
});
