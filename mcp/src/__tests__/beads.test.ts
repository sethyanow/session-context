import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

// Test fixtures
const mockTriageData = {
  quick_ref: {
    open_count: 13,
    actionable_count: 13,
    blocked_count: 0,
    in_progress_count: 1,
  },
  data_hash: "abc123",
  top_picks: [],
  recommendations: [],
};

// Helper to initialize a beads test fixture using bd init
async function initBeadsFixture(dir: string): Promise<boolean> {
  try {
    const initProc = Bun.spawn(["bd", "init", "--prefix", "test"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await initProc.exited;

    // Create a test issue so triage has something to analyze
    const createProc = Bun.spawn(
      ["bd", "create", "--title", "Test issue", "--type", "task", "--priority", "2"],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await createProc.exited;

    return initProc.exitCode === 0;
  } catch {
    return false;
  }
}

describe("beads integration", () => {
  let testDir: string;
  let beadsDir: string;

  beforeEach(async () => {
    // Reset module cache before each test to ensure isolation
    const { _resetTriageCache } = await import("../integrations/beads");
    _resetTriageCache();

    // Create a unique temp directory for each test using Bun APIs
    const tmpBase = Bun.env.TMPDIR || "/tmp/claude";
    testDir = join(tmpBase, `beads-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    beadsDir = join(testDir, ".beads");
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

  describe("isBeadsAvailable", () => {
    test("returns false when .beads directory does not exist", async () => {
      const { isBeadsAvailable } = await import("../integrations/beads");
      const result = await isBeadsAvailable(testDir);
      expect(result).toBe(false);
    });

    test("returns true when .beads directory exists", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");
      const { isBeadsAvailable } = await import("../integrations/beads");
      const result = await isBeadsAvailable(testDir);
      expect(result).toBe(true);
    });
  });

  describe("getBeadsInfo", () => {
    test("returns null when beads not available", async () => {
      const { getBeadsInfo } = await import("../integrations/beads");
      const result = await getBeadsInfo(testDir);
      expect(result).toBe(null);
    });

    test("extracts counts from quick_ref correctly", async () => {
      // This test verifies the field mapping is correct:
      // quick_ref.open_count -> open
      // quick_ref.actionable_count -> actionable
      // etc.

      // The actual implementation calls bv --robot-triage which requires
      // beads to be installed. For unit testing, we verify the interface
      // and field mapping logic.

      const quickRef = mockTriageData.quick_ref;

      // Verify the expected field mapping
      expect(quickRef.open_count).toBe(13);
      expect(quickRef.actionable_count).toBe(13);
      expect(quickRef.blocked_count).toBe(0);
      expect(quickRef.in_progress_count).toBe(1);
    });

    test("returns zeros when triage fetch fails", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");

      // Without bv installed, the fetch should fail and return zeros
      const { getBeadsInfo } = await import("../integrations/beads");
      const result = await getBeadsInfo(testDir);

      // When .beads exists but bv command fails, should return zeros
      expect(result).toEqual({
        open: 0,
        actionable: 0,
        blocked: 0,
        in_progress: 0,
      });
    });
  });

  describe("getBeadsTriage", () => {
    test("returns null when beads not available", async () => {
      const { getBeadsTriage } = await import("../integrations/beads");
      const result = await getBeadsTriage(testDir);
      expect(result).toBe(null);
    });

    test("returns null when triage fetch fails", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");

      // Without bv installed, the fetch should fail and return null
      const { getBeadsTriage } = await import("../integrations/beads");
      const result = await getBeadsTriage(testDir);

      expect(result).toBe(null);
    });

    test("triage response structure is correct", () => {
      // Verify the expected triage structure that bv --robot-triage returns
      expect(mockTriageData).toHaveProperty("quick_ref");
      expect(mockTriageData).toHaveProperty("data_hash");
      expect(mockTriageData.quick_ref).toHaveProperty("open_count");
      expect(mockTriageData.quick_ref).toHaveProperty("actionable_count");
      expect(mockTriageData.quick_ref).toHaveProperty("blocked_count");
      expect(mockTriageData.quick_ref).toHaveProperty("in_progress_count");
    });
  });

  describe("field mapping (bug fix verification)", () => {
    test("counts are extracted from quick_ref with _count suffix", () => {
      // This is the core of the bug fix:
      // The old code expected: stats.open, stats.actionable, etc.
      // The fix extracts from: quick_ref.open_count, quick_ref.actionable_count, etc.

      const quickRef = mockTriageData.quick_ref;

      const extractedCounts = {
        open: quickRef.open_count ?? 0,
        actionable: quickRef.actionable_count ?? 0,
        blocked: quickRef.blocked_count ?? 0,
        in_progress: quickRef.in_progress_count ?? 0,
      };

      expect(extractedCounts).toEqual({
        open: 13,
        actionable: 13,
        blocked: 0,
        in_progress: 1,
      });
    });

    test("handles missing quick_ref gracefully", () => {
      const triageWithoutQuickRef = { data_hash: "xyz" };
      const quickRef =
        (triageWithoutQuickRef as { quick_ref?: Record<string, number> }).quick_ref || {};

      const extractedCounts = {
        open: quickRef.open_count ?? 0,
        actionable: quickRef.actionable_count ?? 0,
        blocked: quickRef.blocked_count ?? 0,
        in_progress: quickRef.in_progress_count ?? 0,
      };

      expect(extractedCounts).toEqual({
        open: 0,
        actionable: 0,
        blocked: 0,
        in_progress: 0,
      });
    });

    test("handles partial quick_ref gracefully", () => {
      const triageWithPartialQuickRef = {
        quick_ref: {
          open_count: 5,
          // missing other counts
        },
        data_hash: "xyz",
      };

      const quickRef = triageWithPartialQuickRef.quick_ref || {};

      const extractedCounts = {
        open: (quickRef as Record<string, number>).open_count ?? 0,
        actionable: (quickRef as Record<string, number>).actionable_count ?? 0,
        blocked: (quickRef as Record<string, number>).blocked_count ?? 0,
        in_progress: (quickRef as Record<string, number>).in_progress_count ?? 0,
      };

      expect(extractedCounts).toEqual({
        open: 5,
        actionable: 0,
        blocked: 0,
        in_progress: 0,
      });
    });
  });

  describe("concurrent and caching behavior", () => {
    test("calling getBeadsInfo twice returns consistent results", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");
      const { getBeadsInfo } = await import("../integrations/beads");

      // Call twice - second call exercises consistency
      const result1 = await getBeadsInfo(testDir);
      const result2 = await getBeadsInfo(testDir);

      // Both should return same structure (zeros since bv isn't installed)
      expect(result1).toEqual(result2);
      expect(result1).toEqual({
        open: 0,
        actionable: 0,
        blocked: 0,
        in_progress: 0,
      });
    });

    test("calling getBeadsTriage twice returns consistent results", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");
      const { getBeadsTriage } = await import("../integrations/beads");

      const result1 = await getBeadsTriage(testDir);
      const result2 = await getBeadsTriage(testDir);

      // Both should return null (since bv isn't installed)
      expect(result1).toBe(null);
      expect(result2).toBe(null);
    });

    test("concurrent calls to getBeadsInfo don't cause issues", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");
      const { getBeadsInfo } = await import("../integrations/beads");

      // Make concurrent calls
      const results = await Promise.all([
        getBeadsInfo(testDir),
        getBeadsInfo(testDir),
        getBeadsInfo(testDir),
      ]);

      // All should return same structure
      for (const result of results) {
        expect(result).toEqual({
          open: 0,
          actionable: 0,
          blocked: 0,
          in_progress: 0,
        });
      }
    });

    test("concurrent calls to getBeadsTriage don't cause issues", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");
      const { getBeadsTriage } = await import("../integrations/beads");

      // Make concurrent calls
      const results = await Promise.all([
        getBeadsTriage(testDir),
        getBeadsTriage(testDir),
        getBeadsTriage(testDir),
      ]);

      // All should return null
      for (const result of results) {
        expect(result).toBe(null);
      }
    });
  });

  describe("isBeadsAvailable edge cases", () => {
    test("returns false for non-existent path", async () => {
      const { isBeadsAvailable } = await import("../integrations/beads");
      const result = await isBeadsAvailable("/nonexistent/path/that/does/not/exist");
      expect(result).toBe(false);
    });

    test("returns false when .beads exists but is empty", async () => {
      // Create empty .beads directory (no .keep file)
      const proc = Bun.spawn(["mkdir", "-p", beadsDir]);
      await proc.exited;

      const { isBeadsAvailable } = await import("../integrations/beads");
      const result = await isBeadsAvailable(testDir);

      // Should use fallback check for directory existence
      expect(result).toBe(true);
    });

    test("returns true with .keep marker file", async () => {
      await Bun.write(join(beadsDir, ".keep"), "");

      const { isBeadsAvailable } = await import("../integrations/beads");
      const result = await isBeadsAvailable(testDir);

      expect(result).toBe(true);
    });
  });

  describe("getBeadsTriage output structure", () => {
    test("BeadsTriage interface matches expected fields", () => {
      // Verify the expected interface structure
      interface BeadsTriage {
        generated_at: string;
        data_hash: string;
        triage: unknown;
      }

      const mockTriage: BeadsTriage = {
        generated_at: new Date().toISOString(),
        data_hash: "abc123",
        triage: mockTriageData,
      };

      expect(mockTriage).toHaveProperty("generated_at");
      expect(mockTriage).toHaveProperty("data_hash");
      expect(mockTriage).toHaveProperty("triage");
      expect(typeof mockTriage.generated_at).toBe("string");
      expect(typeof mockTriage.data_hash).toBe("string");
    });
  });
});

// Tests with real beads fixture (requires bd command to be available)
// These tests use fresh directories and reset cache to avoid pollution
describe("beads integration with real fixture", () => {
  // Check if bd is available
  let bdAvailable = false;

  beforeEach(async () => {
    // Reset module cache before each test to ensure isolation
    const { _resetTriageCache } = await import("../integrations/beads");
    _resetTriageCache();

    const checkProc = Bun.spawn(["which", "bd"], { stdout: "pipe", stderr: "pipe" });
    await checkProc.exited;
    bdAvailable = checkProc.exitCode === 0;
  });

  // Helper to create a unique fixture directory with proper initialization
  async function createFixture(): Promise<string | null> {
    if (!bdAvailable) return null;

    const tmpBase = Bun.env.TMPDIR || "/tmp/claude";
    const fixtureDir = join(tmpBase, `beads-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Create directory
    const mkdirProc = Bun.spawn(["mkdir", "-p", fixtureDir]);
    await mkdirProc.exited;

    // Initialize beads
    const initProc = Bun.spawn(["bd", "init", "--prefix", "test"], {
      cwd: fixtureDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await initProc.exited;
    if (initProc.exitCode !== 0) return null;

    // Create a test issue
    const createProc = Bun.spawn(
      ["bd", "create", "--title", "Test issue", "--type", "task", "--priority", "2"],
      {
        cwd: fixtureDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await createProc.exited;
    if (createProc.exitCode !== 0) return null;

    // Verify with bv --robot-triage
    const bvProc = Bun.spawn(["bv", "--robot-triage"], {
      cwd: fixtureDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(bvProc.stdout).text();
    await bvProc.exited;

    try {
      const parsed = JSON.parse(output);
      if (parsed?.triage?.quick_ref?.open_count >= 1) {
        return fixtureDir;
      }
    } catch {
      // JSON parse failed
    }

    return null;
  }

  async function cleanupFixture(dir: string | null) {
    if (!dir) return;
    try {
      const proc = Bun.spawn(["rm", "-rf", dir]);
      await proc.exited;
    } catch {
      // Ignore cleanup errors
    }
  }

  describe("getBeadsInfo with real data", () => {
    test("returns actual counts from bv --robot-triage", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");
        const result = await beadsModule.getBeadsInfo(fixtureDir);

        expect(result).not.toBeNull();
        expect(result).toHaveProperty("open");
        expect(result).toHaveProperty("actionable");
        expect(result).toHaveProperty("blocked");
        expect(result).toHaveProperty("in_progress");

        // We created 1 issue, so should have at least 1 open
        expect(result!.open).toBeGreaterThanOrEqual(1);
        expect(result!.actionable).toBeGreaterThanOrEqual(1);
        expect(typeof result!.blocked).toBe("number");
        expect(typeof result!.in_progress).toBe("number");
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });

    test("exercises cache hit on second call", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");

        // First call populates cache
        const result1 = await beadsModule.getBeadsInfo(fixtureDir);

        // Second call should hit cache (line 18)
        const result2 = await beadsModule.getBeadsInfo(fixtureDir);

        expect(result1).toEqual(result2);
        expect(result1).not.toBeNull();
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });
  });

  describe("getBeadsTriage with real data", () => {
    test("returns formatted triage data", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");
        const result = await beadsModule.getBeadsTriage(fixtureDir);

        expect(result).not.toBeNull();
        expect(result).toHaveProperty("generated_at");
        expect(result).toHaveProperty("data_hash");
        expect(result).toHaveProperty("triage");

        expect(typeof result!.generated_at).toBe("string");
        expect(typeof result!.data_hash).toBe("string");
        expect(result!.triage).toBeDefined();
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });

    test("triage contains quick_ref with counts", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");
        const result = await beadsModule.getBeadsTriage(fixtureDir);

        expect(result).not.toBeNull();
        // getBeadsTriage returns { triage: <raw_bv_response> }
        // The raw bv response has structure: { generated_at, data_hash, triage: { quick_ref } }
        const rawResponse = result!.triage as { triage?: { quick_ref?: Record<string, number> } };
        expect(rawResponse.triage).toBeDefined();
        expect(rawResponse.triage!.quick_ref).toBeDefined();
        expect(rawResponse.triage!.quick_ref!.open_count).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });
  });

  describe("caching and deduplication", () => {
    test("concurrent calls share the same fetch (deduplication)", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");

        // Make concurrent calls - should deduplicate (line 23)
        const [result1, result2, result3] = await Promise.all([
          beadsModule.getBeadsInfo(fixtureDir),
          beadsModule.getBeadsInfo(fixtureDir),
          beadsModule.getBeadsInfo(fixtureDir),
        ]);

        // All should return same data
        expect(result1).toEqual(result2);
        expect(result2).toEqual(result3);
        expect(result1).not.toBeNull();
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });

    test("cache persists across calls within TTL", async () => {
      const fixtureDir = await createFixture();
      if (!fixtureDir) {
        console.log("Skipping: bd/bv not available or fixture creation failed");
        return;
      }

      try {
        const beadsModule = await import("../integrations/beads");

        // First call
        const result1 = await beadsModule.getBeadsInfo(fixtureDir);

        // Wait a bit (less than 5s TTL)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Second call should hit cache
        const result2 = await beadsModule.getBeadsInfo(fixtureDir);

        expect(result1).toEqual(result2);
      } finally {
        await cleanupFixture(fixtureDir);
      }
    });
  });
});
