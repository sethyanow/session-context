/**
 * Environment configuration for tests
 *
 * Manages environment variables for isolated test execution
 */

export interface TestEnvironment {
  originalEnv: Record<string, string | undefined>;
  apply: () => void;
  restore: () => void;
}

/**
 * Create environment for mock server testing
 */
export function createMockServerEnv(
  port: number,
  homeDir: string
): TestEnvironment {
  const envVars: Record<string, string> = {
    HOME: homeDir,
    ANTHROPIC_AUTH_TOKEN: "test-token",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    NO_PROXY: "127.0.0.1",
    DISABLE_TELEMETRY: "true",
    DISABLE_COST_WARNINGS: "true",
  };

  const originalEnv: Record<string, string | undefined> = {};

  return {
    originalEnv,
    apply: () => {
      for (const [key, value] of Object.entries(envVars)) {
        originalEnv[key] = process.env[key];
        process.env[key] = value;
      }
    },
    restore: () => {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

/**
 * Create environment for real API testing (via ccr)
 */
export function createRealApiEnv(homeDir: string): TestEnvironment {
  const envVars: Record<string, string> = {
    HOME: homeDir,
  };

  const originalEnv: Record<string, string | undefined> = {};

  return {
    originalEnv,
    apply: () => {
      for (const [key, value] of Object.entries(envVars)) {
        originalEnv[key] = process.env[key];
        process.env[key] = value;
      }
    },
    restore: () => {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

/**
 * Preserve and restore HOME environment variable
 */
export function withHomeOverride(
  homeDir: string,
  fn: () => Promise<void>
): Promise<void> {
  const originalHome = process.env.HOME;

  return (async () => {
    try {
      process.env.HOME = homeDir;
      await fn();
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  })();
}
