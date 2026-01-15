#!/usr/bin/env bun
/**
 * Smoke test runner for session-context plugin
 *
 * Usage:
 *   bun tests/smoke/runner.ts [--real-api] [--scenario=<name>]
 *
 * Options:
 *   --real-api       Use real Claude API through ccr (requires ANTHROPIC_API_KEY)
 *   --scenario=name  Run only the specified scenario
 *   --verbose        Show detailed output
 */

import { runFileEditFlow } from "./scenarios/file-edit-flow.js";
import { runHandoffFlow } from "./scenarios/handoff-flow.js";

export interface SmokeTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

type ScenarioFn = (useRealApi: boolean) => Promise<SmokeTestResult>;

const scenarios: Record<string, ScenarioFn> = {
  "file-edit-flow": runFileEditFlow,
  "handoff-flow": runHandoffFlow,
};

async function runAllSmokeTests(
  useRealApi: boolean,
  specificScenario?: string
): Promise<SmokeTestResult[]> {
  const mode = useRealApi ? "REAL API" : "mock/direct";
  console.log(`\n🔥 Running smoke tests (${mode})...\n`);

  const results: SmokeTestResult[] = [];

  const scenariosToRun = specificScenario
    ? { [specificScenario]: scenarios[specificScenario] }
    : scenarios;

  if (specificScenario && !scenarios[specificScenario]) {
    console.error(`Unknown scenario: ${specificScenario}`);
    console.error(`Available scenarios: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }

  for (const [name, scenarioFn] of Object.entries(scenariosToRun)) {
    console.log(`  Running: ${name}...`);

    try {
      const result = await scenarioFn(useRealApi);
      results.push(result);

      const status = result.passed ? "✅ PASS" : "❌ FAIL";
      console.log(`  ${status} ${result.name} (${result.duration}ms)`);

      if (!result.passed && result.error) {
        console.log(`    Error: ${result.error}`);
      }

      if (result.details && process.argv.includes("--verbose")) {
        console.log(`    Details:`, JSON.stringify(result.details, null, 2));
      }
    } catch (error) {
      const result: SmokeTestResult = {
        name,
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.log(`  ❌ FAIL ${name}`);
      console.log(`    Error: ${result.error}`);
    }
  }

  return results;
}

function printSummary(results: SmokeTestResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n${"=".repeat(50)}`);
  console.log("Smoke Test Summary");
  console.log(`${"=".repeat(50)}`);
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Failed: ${failed}/${total}`);
  console.log(`Total Duration: ${totalDuration}ms`);

  if (failed > 0) {
    console.log(`\nFailed tests:`);
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${result.name}: ${result.error}`);
    }
  }
}

// Parse arguments
const args = process.argv.slice(2);
const useRealApi = args.includes("--real-api");
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
const specificScenario = scenarioArg?.split("=")[1];

// Validate environment for real API mode
if (useRealApi && !process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY required for --real-api mode");
  console.error("Either set the environment variable or use ccr to configure routing");
  process.exit(1);
}

// Run tests
const results = await runAllSmokeTests(useRealApi, specificScenario);
printSummary(results);

const exitCode = results.every((r) => r.passed) ? 0 : 1;
process.exit(exitCode);
