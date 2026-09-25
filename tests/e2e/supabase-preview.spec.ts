import { expect, test } from '@playwright/test'

test('signed-out cloud Preview shows sign-in without opening local projects', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, mode: 'supabase', code: 'UNAUTHENTICATED' }),
  }))
  await page.route('**/api/auth/refresh', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, mode: 'supabase', code: 'UNAUTHENTICATED' }),
  }))
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
})

test('a member sees the resolved workspace, not browser-local projects', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      mode: 'supabase',
      userId: 'verified-user-123',
      activeWorkspaceId: 'workspace-123',
      activeRole: 'editor',
      activeOrganizationName: 'GypsySystems',
      activeWorkspaceName: 'AI Content Studio',
    }),
  }))
  let readinessChecked = false
  await page.route('**/api/cloud-projects', async route => {
    const request = route.request().postDataJSON() as { action?: string }
    if (request.action === 'ready') {
      readinessChecked = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ready: false }),
      })
    }
    return route.fulfill({ status: 400, json: { code: 'UNEXPECTED_ACTION', error: 'Unexpected request.' } })
  })
  await page.route('**/api/auth/logout', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, mode: 'supabase' }),
  }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GypsySystems / AI Content Studio' })).toBeVisible()
  await expect(page.getByText(/Cloud project storage is not ready yet/)).toBeVisible()
  expect(readinessChecked).toBe(true)
  // A signed-in member remains behind the readiness gate; local creation stays unavailable.
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out.')).toBeVisible()
})