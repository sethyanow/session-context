/**
 * Integration test for configuration and privacy filtering
 */
import { describe, expect, test } from "bun:test";
import { getConfig } from "../storage/handoffs.js";
import { shouldExcludeFile } from "../utils/privacy.js";

describe("Configuration System Integration", () => {
  test("loads configuration with defaults", async () => {
    const config = await getConfig();

    expect(config.version).toBe(1);
    expect(config.tracking.enabled).toBe(true);
    expect(config.tracking.trackEdits).toBe(true);
    expect(config.tracking.trackTodos).toBe(true);
    expect(config.tracking.trackPlans).toBe(true);
    expect(config.tracking.trackUserDecisions).toBe(true);
  });

  test("includes all configuration sections", async () => {
    const config = await getConfig();

    expect(config.tracking).toBeDefined();
    expect(config.checkpoints).toBeDefined();
    expect(config.recovery).toBeDefined();
    expect(config.marker).toBeDefined();
    expect(config.integrations).toBeDefined();
    expect(config.privacy).toBeDefined();
  });

  test("privacy excludePatterns are loaded", async () => {
    const config = await getConfig();

    expect(Array.isArray(config.privacy.excludePatterns)).toBe(true);
    expect(config.privacy.excludePatterns).toContain("**/.env*");
    expect(config.privacy.excludePatterns).toContain("**/secrets/**");
    expect(config.privacy.excludePatterns).toContain("**/credentials*");
  });
});

describe("Privacy Filtering Integration", () => {
  const patterns = ["**/.env*", "**/secrets/**", "**/credentials*"];

  test("excludes .env files", () => {
    expect(shouldExcludeFile(".env", patterns)).toBe(true);
    expect(shouldExcludeFile(".env.local", patterns)).toBe(true);
    expect(shouldExcludeFile(".env.production", patterns)).toBe(true);
    expect(shouldExcludeFile("config/.env", patterns)).toBe(true);
    expect(shouldExcludeFile("app/config/.env.local", patterns)).toBe(true);
  });

  test("excludes secrets directories", () => {
    expect(shouldExcludeFile("secrets/api-key.txt", patterns)).toBe(true);
    expect(shouldExcludeFile("app/secrets/token.json", patterns)).toBe(true);
    expect(shouldExcludeFile("config/secrets/db-password.txt", patterns)).toBe(true);
  });

  test("excludes credentials files", () => {
    expect(shouldExcludeFile("credentials.json", patterns)).toBe(true);
    expect(shouldExcludeFile("config/credentials.yml", patterns)).toBe(true);
    expect(shouldExcludeFile("src/utils/credentials-helper.ts", patterns)).toBe(true);
  });

  test("includes normal files", () => {
    expect(shouldExcludeFile("src/index.ts", patterns)).toBe(false);
    expect(shouldExcludeFile("README.md", patterns)).toBe(false);
    expect(shouldExcludeFile("package.json", patterns)).toBe(false);
    expect(shouldExcludeFile("src/utils/config.ts", patterns)).toBe(false);
    expect(shouldExcludeFile("docs/environment-setup.md", patterns)).toBe(false);
  });

  test("handles edge cases", () => {
    // Files with "env" in name but not .env
    expect(shouldExcludeFile("src/environment.ts", patterns)).toBe(false);
    expect(shouldExcludeFile("docs/env-vars.md", patterns)).toBe(false);

    // Files with "secret" in name but not in secrets/
    expect(shouldExcludeFile("src/secret-manager.ts", patterns)).toBe(false);

    // Files with "credential" substring but not matching pattern
    expect(shouldExcludeFile("src/credential.ts", patterns)).toBe(false);
  });
});

describe("Configuration + Privacy Integration", () => {
  test("privacy patterns from config work with shouldExcludeFile", async () => {
    const config = await getConfig();
    const patterns = config.privacy.excludePatterns;

    // Should exclude sensitive files
    expect(shouldExcludeFile(".env", patterns)).toBe(true);
    expect(shouldExcludeFile("secrets/key.txt", patterns)).toBe(true);
    expect(shouldExcludeFile("credentials.json", patterns)).toBe(true);

    // Should include normal files
    expect(shouldExcludeFile("src/index.ts", patterns)).toBe(false);
    expect(shouldExcludeFile("README.md", patterns)).toBe(false);
  });

  test("configuration respects deep merge semantics", async () => {
    const config = await getConfig();

    // Each section should be independently mergeable
    // If user provides partial config, defaults should fill in missing values
    expect(config.tracking).toHaveProperty("enabled");
    expect(config.tracking).toHaveProperty("trackEdits");
    expect(config.tracking).toHaveProperty("trackTodos");
    expect(config.tracking).toHaveProperty("trackPlans");
    expect(config.tracking).toHaveProperty("trackUserDecisions");

    expect(config.checkpoints).toHaveProperty("rollingEnabled");
    expect(config.checkpoints).toHaveProperty("rollingMaxAge");
    expect(config.checkpoints).toHaveProperty("explicitTTL");
    expect(config.checkpoints).toHaveProperty("maxStoredHandoffs");
  });
});
