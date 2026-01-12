/**
 * Tests for configuration reload/caching behavior
 * Documents that config is read fresh on each getConfig() call
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getConfig } from "../storage/handoffs.js";

describe("Configuration Reload Behavior", () => {
  let testDir: string;
  let configPath: string;
  let originalConfigPath: string | undefined;

  beforeEach(async () => {
    testDir = join(tmpdir(), `config-reload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    const configDir = join(testDir, ".claude", "session-context");
    await mkdir(configDir, { recursive: true });
    configPath = join(configDir, "config.json");

    originalConfigPath = process.env.SESSION_CONTEXT_CONFIG_PATH;
    process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;
  });

  afterEach(async () => {
    if (originalConfigPath !== undefined) {
      process.env.SESSION_CONTEXT_CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.SESSION_CONTEXT_CONFIG_PATH;
    }

    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("config changes are picked up on subsequent reads", async () => {
    // First read - no config file, uses defaults
    const config1 = await getConfig();
    expect(config1.tracking.enabled).toBe(true);

    // Write config file
    await writeFile(configPath, JSON.stringify({
      tracking: { enabled: false },
    }));

    // Second read - should pick up the new value
    const config2 = await getConfig();
    expect(config2.tracking.enabled).toBe(false);
  });

  test("config deletion reverts to defaults", async () => {
    // Write initial config
    await writeFile(configPath, JSON.stringify({
      tracking: { enabled: false },
    }));

    const config1 = await getConfig();
    expect(config1.tracking.enabled).toBe(false);

    // Delete config file
    await rm(configPath);

    // Should revert to defaults
    const config2 = await getConfig();
    expect(config2.tracking.enabled).toBe(true);
  });

  test("rapid config reads are consistent", async () => {
    await writeFile(configPath, JSON.stringify({
      checkpoints: { maxStoredHandoffs: 100 },
    }));

    // Multiple rapid reads should all return the same value
    const configs = await Promise.all([
      getConfig(),
      getConfig(),
      getConfig(),
      getConfig(),
      getConfig(),
    ]);

    for (const config of configs) {
      expect(config.checkpoints.maxStoredHandoffs).toBe(100);
    }
  });

  test("config changes during operation are reflected", async () => {
    // Start with one config
    await writeFile(configPath, JSON.stringify({
      privacy: { excludePatterns: ["**/.env*"] },
    }));

    const config1 = await getConfig();
    expect(config1.privacy.excludePatterns).toEqual(["**/.env*"]);

    // Simulate runtime config update
    await writeFile(configPath, JSON.stringify({
      privacy: { excludePatterns: ["**/.env*", "**/secrets/**", "**/keys/**"] },
    }));

    const config2 = await getConfig();
    expect(config2.privacy.excludePatterns).toContain("**/secrets/**");
    expect(config2.privacy.excludePatterns).toContain("**/keys/**");
  });

  test("environment variable override is respected", async () => {
    // Write to default location
    const defaultConfig = join(testDir, ".claude", "session-context", "config.json");
    await writeFile(defaultConfig, JSON.stringify({
      version: 99,
    }));

    // Override path via environment variable
    const overridePath = join(testDir, "custom-config.json");
    await writeFile(overridePath, JSON.stringify({
      version: 42,
    }));

    process.env.SESSION_CONTEXT_CONFIG_PATH = overridePath;

    const config = await getConfig();
    expect(config.version).toBe(42);
  });
});

describe("Configuration Isolation", () => {
  let testDir: string;
  let configPath: string;
  let originalConfigPath: string | undefined;

  beforeEach(async () => {
    testDir = join(tmpdir(), `config-isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    const configDir = join(testDir, ".claude", "session-context");
    await mkdir(configDir, { recursive: true });
    configPath = join(configDir, "config.json");

    originalConfigPath = process.env.SESSION_CONTEXT_CONFIG_PATH;
    process.env.SESSION_CONTEXT_CONFIG_PATH = configPath;
  });

  afterEach(async () => {
    if (originalConfigPath !== undefined) {
      process.env.SESSION_CONTEXT_CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.SESSION_CONTEXT_CONFIG_PATH;
    }

    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("config modifications don't affect returned objects", async () => {
    await writeFile(configPath, JSON.stringify({
      tracking: { enabled: true },
    }));

    const config = await getConfig();

    // Modify the returned object
    config.tracking.enabled = false;
    config.checkpoints.maxStoredHandoffs = 999;

    // Fresh read should have original values
    const freshConfig = await getConfig();
    expect(freshConfig.tracking.enabled).toBe(true);
    expect(freshConfig.checkpoints.maxStoredHandoffs).toBe(20); // default
  });

  test("each call returns independent object", async () => {
    const config1 = await getConfig();
    const config2 = await getConfig();

    // Should be equal
    expect(config1).toEqual(config2);

    // But not the same object
    expect(config1).not.toBe(config2);
    expect(config1.tracking).not.toBe(config2.tracking);
  });
});
