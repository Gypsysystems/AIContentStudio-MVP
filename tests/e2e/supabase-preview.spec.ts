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
      activeWorkspaceId: 'workspace-123',
      activeOrganizationName: 'GypsySystems',
      activeWorkspaceName: 'AI Content Studio',
    }),
  }))
  await page.route('**/api/auth/logout', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, mode: 'supabase' }),
  }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GypsySystems / AI Content Studio' })).toBeVisible()
  await expect(page.getByText('Cloud project access is not enabled yet.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /New Project/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out.')).toBeVisible()
})