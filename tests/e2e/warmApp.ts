import { chromium, type FullConfig } from '@playwright/test'

export default async function warmApp(config: FullConfig): Promise<void> {
  const project = config.projects[0]
  const baseURL = project?.use.baseURL
  if (!baseURL) throw new Error('The Playwright app URL is not configured')

  // Vite reports the server ready before it transforms the app's module graph.
  // Load it once before parallel tests so their 30-second budgets measure the tests.
  const browser = await chromium.launch(project.use.launchOptions ?? {})
  try {
    const page = await browser.newPage()
    await page.goto(baseURL, { waitUntil: 'load', timeout: 120_000 })
  } finally {
    await browser.close()
  }
}