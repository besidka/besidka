import { execFileSync } from 'node:child_process'
import type { Browser, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from './auth'

export const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const CONSENT_COOKIE_NAME = 'cookies_consent'
const ONE_DAY_IN_SECONDS = 60 * 60 * 24

export function markEmailVerified(email: string) {
  execFileSync('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--command',
    `update users set email_verified = 1 where email = '${email}'`,
  ], { stdio: 'ignore' })
}

export async function openSignedInPage(
  browser: Browser,
  user: ReturnType<typeof createUniqueUser>,
  consentId: string = 'e2e-skills',
): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined })

  await context.addCookies([{
    name: CONSENT_COOKIE_NAME,
    value: encodeURIComponent(JSON.stringify({
      v: 2,
      granted: ['necessary', 'preferences'],
      id: consentId,
      date: '2026-01-01T00:00:00.000Z',
    })),
    domain: 'localhost',
    path: '/',
    expires: Math.floor(Date.now() / 1000) + ONE_DAY_IN_SECONDS,
  }])

  const page = await context.newPage()

  await authenticateUserByApi(page, user)

  return page
}

export async function readUserId(page: Page): Promise<number> {
  const response = await page.request.get('/api/auth/get-session')
  const session = await response.json()

  return Number(session.user.id)
}

export async function openGrantedMember(
  browser: Browser,
  prefix: string,
): Promise<Page> {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }
  const member = createUniqueUser(prefix)
  const adminPage = await openSignedInPage(browser, admin)
  const page = await openSignedInPage(browser, member)

  markEmailVerified(E2E_ADMIN_EMAIL)

  const grant = await adminPage.request.post(
    '/api/v1/admin/features/skills/grants',
    {
      data: {
        userId: await readUserId(page),
        effect: 'allow',
        expiresInDays: 1,
      },
    },
  )

  expect(grant.status()).toBe(200)

  return page
}

export async function createSkillByApi(
  page: Page,
  name: string,
  description: string,
  kind: 'blank' | 'command' = 'blank',
): Promise<string> {
  const response = await page.request.post('/api/v1/skills', {
    data: { kind, name, description },
  })

  expect(response.status()).toBe(201)

  return (await response.json()).id
}
