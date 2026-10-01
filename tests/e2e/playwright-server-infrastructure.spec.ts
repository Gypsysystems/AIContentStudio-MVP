import { expect, test } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { open, unlink } from "node:fs/promises"
import { resolve } from "node:path"

test("Playwright browser workers use the dynamically allocated loopback base URL", async ({ page, baseURL }) => {
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const invalidationFrames: string[] = []
  const mainFrameNavigations: string[] = []
  page.on("websocket", socket => {
    socket.on("framereceived", ({ payload }) => {
      let message: unknown
      try {
        message = JSON.parse(String(payload))
      } catch {
        return
      }
      const messages = Array.isArray(message) ? message : [message]
      for (const frame of messages) {
        if (frame && typeof frame === "object") {
          const type = (frame as { type?: unknown }).type
          if (type === "update" || type === "full-reload") invalidationFrames.push(type)
        }
      }
    })
  })
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) mainFrameNavigations.push(frame.url())
  })

  const sentinelPath = resolve(
    process.cwd(),
    "docs",
    `.playwright-watch-isolation-${randomUUID()}.md`,
  )
  let sentinelCreated = false
  try {
    const response = await page.goto("/")

    expect(response?.ok()).toBe(true)
    expect(new URL(page.url()).origin).toBe(baseURL)

    const sentinel = await open(sentinelPath, "wx")
    sentinelCreated = true
    try {
      await sentinel.writeFile(`# Playwright watch isolation sentinel\n\nSynthetic test-only content ${randomUUID()}.\n`)
    } finally {
      await sentinel.close()
    }

    // Give Vite's file watcher a bounded window to surface accidental reloads.
    await page.waitForTimeout(650)
    expect(invalidationFrames).toEqual([])
    expect(mainFrameNavigations).toEqual([`${baseURL}/`])
  } finally {
    if (sentinelCreated) await unlink(sentinelPath)
  }
})