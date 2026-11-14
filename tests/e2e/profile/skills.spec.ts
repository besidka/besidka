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

async function openGrantedMember(
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
    .toContainText('Open licence')
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

  const mode = row.getByTestId('skill-row-mode-select')

  await expect(mode).toHaveValue('off')
  await mode.selectOption('auto')
  await page.getByRole('button', { name: 'Turn on' }).click()

  await expect(mode).toHaveValue('auto')
  await expect(row.getByTestId('skill-row-status')).toHaveCount(0)
  await expect(row.getByTestId('skill-row-tokens')).toContainText('tokens')

  await mode.selectOption('ask')
  await expect(mode).toHaveValue('ask')
  await expect(row.getByTestId('skill-row-tokens')).toHaveCount(0)

  const list = await page.request.get('/api/v1/skills')
  const body = await list.json()

  expect(body.skills).toHaveLength(1)
  expect(body.skills[0]).toMatchObject({
    name: skillName,
    enabled: true,
    modelInvocable: false,
    slashCommand: true,
  })
})

test('a member creates a skill, edits it in the editor and saves version 2', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-skills-editor')
  const skillName = `e2e-editor-${Date.now()}`

  await page.goto('/profile/skills')
  await waitForHydration(page)
  await expect(page.getByTestId('skills-empty')).toBeVisible()

  await page.getByTestId('skills-new-trigger').click()
  await page.getByTestId('skills-new-blank').click()

  const createDialog = page.locator('dialog.js-skill-create-modal')

  await createDialog.getByTestId('skill-create-name').fill(skillName)
  await createDialog.getByTestId('skill-create-description')
    .fill('Summarise a meeting')
  await createDialog.getByTestId('skill-create-submit').click()

  const editor = page.locator('dialog.js-skill-edit-modal')

  await expect(editor).toBeVisible()
  await expect(editor.getByTestId('skills-dialog-title'))
    .toContainText(`Edit ${skillName} · v1`)
  await expect(editor.getByTestId('skill-edit-created-note')).toBeVisible()
  await expect(editor.getByTestId('skill-edit-done')).toBeEnabled()
  await expect(editor.getByTestId('skill-edit-save')).toHaveCount(0)

  await editor.getByTestId('skill-edit-description')
    .fill('Summarise a meeting into decisions and owners')
  await editor.getByTestId('skill-editor-textarea')
    .fill('# Recap\n\nList the decisions and who owns each one.\n')
  await editor.getByTestId('skill-file-add').click()
  await editor.getByTestId('skill-file-path').fill('notes.exe')
  await expect(editor.getByTestId('skill-file-path-help')).toContainText(
    'not allowed',
  )
  await expect(editor.getByTestId('skill-file-form-submit')).toBeDisabled()
  await editor.getByTestId('skill-file-path').fill('references/format.md')
  await editor.getByTestId('skill-file-form-submit').click()
  await editor.getByTestId('skill-editor-textarea')
    .fill('Use short bullet points.\n')

  await editor.getByTestId('skill-editor-tab-model').click()
  await expect(editor.getByTestId('skill-model-view')).toContainText(
    'Use short bullet points.',
  )
  await editor.getByTestId('skill-editor-tab-write').click()
  await editor.getByTestId('skill-edit-note').fill('Added a format file')
  await editor.getByTestId('skill-edit-save').click()

  await expect(editor).toBeHidden()

  const list = await page.request.get('/api/v1/skills')
  const body = await list.json()
  const skill = body.skills.find((entry: { name: string }) => {
    return entry.name === skillName
  })

  expect(skill).toMatchObject({
    currentVersion: 2,
    description: 'Summarise a meeting into decisions and owners',
    filesCount: 2,
  })

  const versions = await page.request.get(
    `/api/v1/skills/${skill.id}/versions`,
  )
  const versionsBody = await versions.json()

  expect(versionsBody.versions[0]).toMatchObject({
    version: 2,
    origin: 'editor',
    note: 'Added a format file',
  })

  const file = await page.request.get(
    `/api/v1/skills/${skill.id}/files?path=references/format.md`,
  )

  expect((await file.json()).text).toBe('Use short bullet points.\n')

  const row = page.getByTestId('skill-row').filter({ hasText: skillName })

  await row.getByTestId('skill-row-actions-trigger').click()
  await row.getByTestId('skill-action-edit').click()
  await expect(editor).toBeVisible()
  await expect(editor.getByTestId('skills-dialog-title'))
    .toContainText('· v2')
  await editor.getByTestId('skill-editor-textarea').fill('# Recap changed\n')
  await editor.getByTestId('skills-dialog-close').click()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(editor).toBeHidden()
})
