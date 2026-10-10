import { mkdir } from 'node:fs/promises'
import { expect, test as setup } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from './helpers/auth'

const AUTH_STATE_PATH = '.playwright/auth-user.json'
const CONSENT_COOKIE_NAME = 'cookies_consent'
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365
const CONSENT_COOKIE_EXPIRES_AT = Math.floor(Date.now() / 1000)
  + ONE_YEAR_IN_SECONDS

setup.setTimeout(30_000)

setup('create authenticated state', async ({ page }) => {
  const user = createUniqueUser('playwright-auth')

  await page.context().addCookies([{
    name: CONSENT_COOKIE_NAME,
    value: encodeURIComponent(JSON.stringify({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: 'e2e-auth',
      date: '2026-01-01T00:00:00.000Z',
    })),
    domain: 'localhost',
    path: '/',
    expires: CONSENT_COOKIE_EXPIRES_AT,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }])

  await authenticateUserByApi(page, user, '/chats/new')
  await expect(page).toHaveURL('/chats/new')

  await mkdir('.playwright', { recursive: true })

  const storageState = await page.context().storageState({
    path: AUTH_STATE_PATH,
  })
  const cookieNames = storageState.cookies.map((cookie) => {
    return cookie.name
  })

  expect(cookieNames).toContain(CONSENT_COOKIE_NAME)
})
