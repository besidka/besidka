import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'
import {
  buildArchive,
  skillMarkdown,
} from '../../setup/helpers/skill-archives'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const MIT_LICENCE_PATH = resolve('tests/fixtures/skills/licences/mit.txt')
const CONSENT_COOKIE_NAME = 'cookies_consent'
const ONE_DAY_IN_SECONDS = 60 * 60 * 24

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

  await context.addCookies([{
    name: CONSENT_COOKIE_NAME,
    value: encodeURIComponent(JSON.stringify({
      v: 2,
      granted: ['necessary', 'preferences'],
      id: 'e2e-skills',
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

async function readUserId(page: Page): Promise<number> {
  const response = await page.request.get('/api/auth/get-session')
  const session = await response.json()

  return Number(session.user.id)
}

function buildSkillArchiveFixture(name: string) {
  const bytes = buildArchive({
    [`${name}/SKILL.md`]: skillMarkdown({
      name,
      description: 'Summarise a meeting into decisions and owners',
      extra: 'license: MIT',
      body: '# Meeting recap\n\nList the decisions and who owns each one.\n',
    }),
    [`${name}/LICENSE.txt`]: readFileSync(MIT_LICENCE_PATH, 'utf8'),
  })

  return Buffer.from(bytes)
}

test('a member uploads a skill, reviews it, installs it and turns it on', async ({ browser }) => {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }
  const member = createUniqueUser('e2e-skills-member')
  const skillName = `e2e-recap-${Date.now()}`
  const adminPage = await openSignedInPage(browser, admin)
  const page = await openSignedInPage(browser, member)

  markEmailVerified(E2E_ADMIN_EMAIL)

  const withoutFlag = await page.request.get('/api/v1/skills')

  expect(withoutFlag.status()).toBe(404)

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

  await page.goto('/profile/skills')
  await waitForHydration(page)

  await expect(
    page.getByRole('navigation', { name: 'Account sections' })
      .getByRole('link', { name: 'Skills' }),
  ).toBeVisible()
  await expect(page.getByTestId('skills-empty')).toBeVisible()

  await page.getByTestId('skills-new-trigger').click()
  await page.getByTestId('skills-new-upload').click()

  const dialog = page.locator('dialog.js-skill-import-modal')

  await expect(dialog).toBeVisible()
  await dialog.getByTestId('skill-import-file').setInputFiles({
    name: `${skillName}.zip`,
    mimeType: 'application/zip',
    buffer: buildSkillArchiveFixture(skillName),
  })
  await dialog.getByTestId('skill-import-submit').click()

  await expect(dialog.getByTestId('skill-review')).toBeVisible()
  await expect(dialog.getByTestId('skill-review-name')).toHaveText(skillName)
  await expect(dialog.getByTestId('skill-review-licence-class'))
    .toHaveText('Open licence')
  await expect(dialog.getByTestId('skill-review-warning')).toContainText(
    'Installing a skill is like installing software.',
  )

  const install = dialog.getByTestId('skill-import-install')

  await expect(install).toBeDisabled()
  await dialog.getByTestId('skill-import-reviewed').check()
  await expect(install).toBeEnabled()
  await install.click()

  await expect(dialog).toBeHidden()

  const row = page.getByTestId('skill-row').filter({ hasText: skillName })

  await expect(row).toBeVisible()
  await expect(row.getByTestId('skill-row-status')).toHaveText('Off')
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await expect(page.getByTestId('skill-detail-description'))
    .toContainText('Summarise a meeting')

  const toggle = row.getByTestId('skill-row-toggle')

  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await page.getByRole('button', { name: 'Turn on' }).click()

  await expect(toggle).toBeChecked()
  await expect(row.getByTestId('skill-row-status')).toHaveCount(0)

  const list = await page.request.get('/api/v1/skills')
  const body = await list.json()

  expect(body.skills).toHaveLength(1)
  expect(body.skills[0]).toMatchObject({ name: skillName, enabled: true })
})
