import { mkdir } from 'node:fs/promises'
import { expect, test as setup } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from './helpers/auth'

const AUTH_STATE_PATH = '.playwright/auth-user.json'

setup.setTimeout(30_000)

setup('create authenticated state', async ({ page }) => {
  const user = createUniqueUser('playwright-auth')

  await authenticateUserByApi(page, user, '/chats/new')
  await expect(page).toHaveURL('/chats/new')

  // Seed a granted consent decision into the shared authenticated state so the
  // cookie banner does not auto-show on every page across the suite. Without
  // this, the banner's auto-show timer, overlay, and receipt POST run on each
  // authenticated test and intermittently interfere with timing-sensitive
  // assertions. Consent-specific specs (cookies/consent.spec.ts) override
  // storageState to start undecided and exercise the banner directly.
  await page.context().addCookies([{
    name: 'cookies_consent',
    value: encodeURIComponent(JSON.stringify({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: 'e2e-auth',
      date: '2026-01-01T00:00:00.000Z',
    })),
    domain: 'localhost',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }])

  await mkdir('.playwright', { recursive: true })
  await page.context().storageState({ path: AUTH_STATE_PATH })
})
