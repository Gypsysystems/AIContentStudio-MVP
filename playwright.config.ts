import { defineConfig, devices } from "@playwright/test"
import { existsSync } from "node:fs"
import {
  createPlaywrightRunPaths,
  resolvePlaywrightRun,
} from "./scripts/playwright-tooling.mjs"

const localChromium = "/repl/tools/bin/chromium"
const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync(localChromium) ? localChromium : undefined)
const playwrightRun = await resolvePlaywrightRun("e2e", { loopbackServer: true })
const appPort = playwrightRun.port!
const baseURL = `http://127.0.0.1:${appPort}`
const runPaths = createPlaywrightRunPaths("e2e", playwrightRun.runId)

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/warmApp.ts",
  outputDir: runPaths.outputDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: runPaths.reportDir, open: "never" }],
  ],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    headless: true,
    launchOptions: {
      executablePath,
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `LOCAL_DEV_AUTH=true pnpm dev --config vite.acceptance.config.ts --host 127.0.0.1 --port ${appPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
})
