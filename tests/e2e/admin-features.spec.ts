import { execFileSync } from 'node:child_process'
import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
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

  expect((await before.json()).features['ui.side-panel-demo'].enabled)
    .toBe(false)

  const grantResponse = await adminPage.request.post(
    '/api/v1/admin/features/ui.side-panel-demo/grants',
    { data: { userId: memberId, effect: 'allow', expiresInDays: 1 } },
  )

  expect(grantResponse.status()).toBe(200)

  const after = await memberPage.request.get('/api/v1/features')

  expect((await after.json()).features['ui.side-panel-demo']).toMatchObject({
    enabled: true,
    active: true,
  })

  await adminPage.goto('/admin/features/ui.side-panel-demo')
  await expect(adminPage.getByTestId('admin-grants-list'))
    .toContainText(member.email)

  const memberPageResponse = await memberPage.goto('/admin/features')

  expect(memberPageResponse?.status()).toBe(404)
})

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    + `-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function daysFromNow(days: number): string {
  return toLocalInputValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
}

function movePendingSchedulesToThePast() {
  const pastSeconds = Math.floor(Date.now() / 1000) - 60

  execFileSync('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--command',
    `update feature_rule_schedules set run_at = ${pastSeconds}`
    + ' where status = \'pending\'',
  ], { stdio: 'ignore' })
}

test('an admin schedules steps, cancels one and the due step applies', async ({
  browser,
}) => {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }
  const adminPage = await openSignedInPage(browser, admin)

  markEmailVerified(E2E_ADMIN_EMAIL)

  await adminPage.goto('/admin/features/documents')
  await waitForHydration(adminPage)
  await expect(adminPage.getByTestId('admin-feature-schedules')).toBeVisible()
  await expect(adminPage.getByTestId('admin-schedule-empty')).toBeVisible()

  const firstRunAt = adminPage.getByTestId('admin-schedule-run-at-0')

  await expect(async () => {
    if (await firstRunAt.count() === 0) {
      await adminPage.getByTestId('admin-schedule-add-step').click()
    }

    await expect(firstRunAt).toBeVisible({ timeout: 1000 })
  }).toPass()
  await firstRunAt.fill(daysFromNow(2))
  await adminPage.getByTestId('admin-schedule-testers-0').check()
  await adminPage.getByTestId('admin-schedule-add-step').click()
  await adminPage.getByTestId('admin-schedule-run-at-1').fill(daysFromNow(3))
  await adminPage.getByTestId('admin-schedule-enabled-1').selectOption('off')
  await adminPage.getByTestId('admin-schedule-submit').click()
  await adminPage.getByTestId('confirmation-action-0').click()

  const list = adminPage.getByTestId('admin-schedule-list')

  await expect(list.locator('li')).toHaveCount(2)
  await expect(list).toContainText('pending')

  await adminPage.locator('[data-testid^="admin-schedule-cancel-"]')
    .last()
    .click()
  await adminPage.getByTestId('confirmation-action-0').click()
  await expect(list).toContainText('cancelled')

  movePendingSchedulesToThePast()

  const applyResponse = await adminPage.request.post(
    '/api/v1/admin/features/schedules/apply-due',
  )

  expect(applyResponse.status()).toBe(200)
  expect((await applyResponse.json()).result).toMatchObject({
    applied: 1,
    failed: 0,
  })

  await adminPage.reload()
  await expect(adminPage.getByTestId('admin-schedule-list'))
    .toContainText('applied')

  const flagResponse = await adminPage.request.get(
    '/api/v1/admin/features/documents',
  )

  expect((await flagResponse.json()).flag.rule.allowRoles)
    .toEqual(['admin', 'tester'])
})
