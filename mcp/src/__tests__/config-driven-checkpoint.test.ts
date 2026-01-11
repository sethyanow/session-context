/**
 * Tests for configuration-driven checkpoint behavior in MCP server
 * Verifies that getConfig respects SessionContextConfig toggles
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { getConfig } from "../storage/handoffs.js";

describe("configuration-driven checkpoint behavior", () => {
  let testConfigPath: string;
  let originalConfigPath: string | undefined;

  beforeEach(async () => {
    // Save original env var
    originalConfigPath = process.env.SESSION_CONTEXT_CONFIG_PATH;

    // Create unique temp config path
    const testDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    testConfigPath = join(testDir, "config.json");

    // Set environment variable to override config path
    process.env.SESSION_CONTEXT_CONFIG_PATH = testConfigPath;
  });

  afterEach(async () => {
    try {
      // Restore original env var
      if (originalConfigPath !== undefined) {
        process.env.SESSION_CONTEXT_CONFIG_PATH = originalConfigPath;
      } else {
        delete process.env.SESSION_CONTEXT_CONFIG_PATH;
      }

      // Clean up test config file
      const testDir = join(testConfigPath, "..");
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getConfig", () => {
    test("should load config with trackEdits enabled", async () => {
      // Create config with trackEdits enabled
      await writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      // Verify config is loaded
      const config = await getConfig();
      expect(config.tracking.enabled).toBe(true);
      expect(config.tracking.trackEdits).toBe(true);
    });

    test("should load config with trackEdits disabled", async () => {
      // Create config with trackEdits disabled
      await writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: false,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      const config = await getConfig();
      expect(config.tracking.enabled).toBe(true);
      expect(config.tracking.trackEdits).toBe(false);
      expect(config.tracking.trackTodos).toBe(true);
    });

    test("should respect default configuration when file doesn't exist", async () => {
      // No config file - should use defaults (all enabled)
      const config = await getConfig();

      expect(config.tracking.enabled).toBe(true);
      expect(config.tracking.trackEdits).toBe(true);
      expect(config.tracking.trackTodos).toBe(true);
      expect(config.tracking.trackPlans).toBe(true);
      expect(config.tracking.trackUserDecisions).toBe(true);
    });

    test("should handle disabled tracking globally", async () => {
      // Create config with tracking globally disabled
      await writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: false,
            trackEdits: true,
            trackTodos: true,
            trackPlans: true,
            trackUserDecisions: true,
          },
        }),
        "utf-8"
      );

      const config = await getConfig();
      expect(config.tracking.enabled).toBe(false);
      // Individual toggles should still be readable
      expect(config.tracking.trackEdits).toBe(true);
    });

    test("should merge partial config with defaults", async () => {
      // Create partial config
      await writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          tracking: {
            enabled: true,
            trackEdits: false,
            // Missing: trackTodos, trackPlans, trackUserDecisions
          },
        }),
        "utf-8"
      );

      const config = await getConfig();
      expect(config.tracking.trackEdits).toBe(false);
      // These should use defaults (true)
      expect(config.tracking.trackTodos).toBe(true);
      expect(config.tracking.trackPlans).toBe(true);
      expect(config.tracking.trackUserDecisions).toBe(true);
    });
  });
});
