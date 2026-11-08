import { execFileSync } from 'node:child_process'
import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from './helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ mode: 'serial', timeout: 90_000 })

function markEmailVerified(email: string) {
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

async function openSignedInPage(
  browser: Browser,
  user: ReturnType<typeof createUniqueUser>,
): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()

  await authenticateUserByApi(page, user)

  return page
}

async function readUserId(page: Page): Promise<number> {
  const response = await page.request.get('/api/auth/get-session')
  const session = await response.json()

  return Number(session.user.id)
}

test('an admin grants a feature to another account', async ({ browser }) => {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }
  const member = createUniqueUser('e2e-admin-member')
  const adminPage = await openSignedInPage(browser, admin)
  const memberPage = await openSignedInPage(browser, member)

  markEmailVerified(E2E_ADMIN_EMAIL)

  const memberAdminResponse = await memberPage.request.get(
    '/api/v1/admin/features',
  )

  expect(memberAdminResponse.status()).toBe(404)

  const memberId = await readUserId(memberPage)
  const before = await memberPage.request.get('/api/v1/features')

  expect((await before.json()).features.artifacts.enabled).toBe(false)

  const grantResponse = await adminPage.request.post(
    '/api/v1/admin/features/artifacts/grants',
    { data: { userId: memberId, effect: 'allow', expiresInDays: 1 } },
  )

  expect(grantResponse.status()).toBe(200)

  const after = await memberPage.request.get('/api/v1/features')

  expect((await after.json()).features.artifacts).toMatchObject({
    enabled: true,
    active: true,
  })

  await adminPage.goto('/admin/features/artifacts')
  await expect(adminPage.getByTestId('admin-grants-list'))
    .toContainText(member.email)

  const memberPageResponse = await memberPage.goto('/admin/features')

  expect(memberPageResponse?.status()).toBe(404)
})
