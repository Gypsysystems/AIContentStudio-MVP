import { defineConfig } from "@playwright/test"
import {
  createPlaywrightRunPaths,
  getPlaywrightRunId,
} from "./scripts/playwright-tooling.mjs"

const runPaths = createPlaywrightRunPaths("sql", getPlaywrightRunId("sql"))

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "**/ai-catalog-cloud.spec.ts",
    "**/generate-topic-jobs-sql.spec.ts",
  ],
  outputDir: runPaths.outputDir,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: runPaths.reportDir, open: "never" }],
  ],
})