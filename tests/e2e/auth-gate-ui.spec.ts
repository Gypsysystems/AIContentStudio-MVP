import { expect, test, type Page } from '@playwright/test'

async function signedOutSession(page: Page) {
  await page.route('**/api/auth/session', route =>
    route.fulfill({ status: 401, json: { authenticated: false, code: 'UNAUTHENTICATED' } }))
  await page.route('**/api/auth/refresh', route =>
    route.fulfill({ status: 401, json: { authenticated: false, code: 'UNAUTHENTICATED' } }))
}

async function fillCredentials(page: Page) {
  await page.getByRole('textbox', { name: 'Email' }).fill('reader@example.test')
  await page.getByLabel('Password').fill('incorrect-password')
}

test('a normal signed-out session shows the form without an error or session retry control', async ({ page }) => {
  await signedOutSession(page)
  await page.goto('/')
  await expect(page.getByText('Sign in to your workspace.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Sign in to continue.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Retry.*session|session.*retry|Retry check session/i })).toHaveCount(0)
})

test('incorrect credentials produce exactly one short error, cleared at the next attempt', async ({ page }) => {
  await signedOutSession(page)
  let attempts = 0
  await page.route('**/api/auth/login', async route => {
    attempts++
    if (attempts === 2) await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({
      status: attempts === 1 ? 401 : 400,
      json: { code: 'INVALID_CREDENTIALS', error: 'Raw provider details must stay hidden' },
    })
  })
  await page.goto('/')
  await fillCredentials(page)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.')
  await expect(page.getByText('Incorrect email or password.', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Raw provider details must stay hidden')).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.')
  await expect(page.getByRole('alert')).toHaveCount(1)
})

test('unreachable auth service and service errors show one generic connection message', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.abort('failed'))
  await page.goto('/')
  await expect(page.getByRole('alert')).toHaveText('Unable to connect. Try again shortly.')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Retry.*session|session.*retry/i })).toHaveCount(0)

  await page.unroute('**/api/auth/session')
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 503, json: { code: 'AUTH_PROVIDER_UNAVAILABLE', error: 'Raw server details' },
  }))
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText('Unable to connect. Try again shortly.')
  await expect(page.getByText('Raw server details')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(1)
})

test('a connection failure during sign-in shows only the generic connection message', async ({ page }) => {
  await signedOutSession(page)
  await page.route('**/api/auth/login', route => route.abort('failed'))
  await page.goto('/')
  await fillCredentials(page)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Unable to connect. Try again shortly.')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Retry.*session|session.*retry/i })).toHaveCount(0)
})

test('inactive membership has its own short message', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 403, json: { code: 'MEMBERSHIP_INACTIVE', error: 'Raw membership details' },
  }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toHaveText('Your account is inactive. Contact an administrator.')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
})

test('successful sign-in and an existing valid session bypass the sign-in form', async ({ page }) => {
  let authenticated = false
  await page.route('**/api/auth/session', route => route.fulfill({
    status: authenticated ? 200 : 401,
    json: authenticated
      ? { authenticated: true, mode: 'local-dev' }
      : { authenticated: false, code: 'UNAUTHENTICATED' },
  }))
  await page.route('**/api/auth/refresh', route =>
    route.fulfill({ status: 401, json: { authenticated: false } }))
  await page.route('**/api/auth/login', route => {
    authenticated = true
    return route.fulfill({ status: 200, json: { authenticated: true } })
  })
  await page.goto('/')
  await fillCredentials(page)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)
})