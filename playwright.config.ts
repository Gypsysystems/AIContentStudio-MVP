import { defineConfig, devices } from "@playwright/test"
import { existsSync } from "node:fs"

const localChromium = "/repl/tools/bin/chromium"
const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync(localChromium) ? localChromium : undefined)

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
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
    command: "LOCAL_DEV_AUTH=true pnpm dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
})
