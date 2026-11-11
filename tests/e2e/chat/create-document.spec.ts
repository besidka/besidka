import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { getDocumentFileName } from '../../../shared/utils/documents'
import {
  TEST_DOCUMENT_HEADINGS,
  TEST_DOCUMENT_TITLE,
} from '../../../server/utils/chats/test/document-fixture'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

interface DocumentStatus {
  id: string
  format: string
  status: string
  renderedBy: string | null
  errorCode: string | null
  file: {
    id: string
    storageKey: string
    name: string
    size: number
    type: string
  } | null
}

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const DOCUMENT_URL = '/chats/test?scenario=document&messages=1'
const PERSISTED_DOCUMENT_URL = '/chats/test?scenario=document&messages=2'
const DOCUMENT_STATUS_PATTERN = /\/api\/v1\/documents\/[^/?]+$/
const DOCUMENT_RENDER_PATTERN = /\/api\/v1\/documents\/[^/?]+\/render$/
const READY_TIMEOUT = 60_000
const FILE_NAME = getDocumentFileName(TEST_DOCUMENT_TITLE, 'docx')
const ZIP_SIGNATURE = 'PK'

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
})

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 2,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])
})

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

async function signInWithDocuments(page: Page) {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }

  await authenticateUserByApi(page, admin)
  markEmailVerified(E2E_ADMIN_EMAIL)

  const features = await page.request.get('/api/v1/features')

  expect((await features.json()).features.documents).toMatchObject({
    active: true,
  })
}

async function sendMessage(page: Page, message: string) {
  const input = page.locator('textarea').first()

  await input.fill(message)
  await input.press('Enter')
}

function watchDocumentStatus(page: Page): Promise<DocumentStatus> {
  return page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && DOCUMENT_STATUS_PATTERN.test(response.url())
      && response.ok()
  }).then(response => response.json())
}

async function openDocumentChat(page: Page): Promise<void> {
  await page.goto(DOCUMENT_URL)
  await waitForHydration(page)
  await expect(
    page.locator('[data-testid="chat-messages-container"]'),
  ).toBeVisible()
}

async function fetchDocumentStatus(
  page: Page,
  documentId: string,
): Promise<DocumentStatus> {
  const response = await page.request.get(`/api/v1/documents/${documentId}`)

  expect(response.ok()).toBe(true)

  return response.json()
}

function readFileStart(path: string): string {
  return readFileSync(path)
    .subarray(0, ZIP_SIGNATURE.length)
    .toString('latin1')
}

async function expectDownloadIsZip(
  page: Page,
  link: Locator,
): Promise<void> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    link.click(),
  ])

  expect(download.suggestedFilename()).toBe(FILE_NAME)
  expect(readFileStart(await download.path())).toBe(ZIP_SIGNATURE)
}

async function openGeneratedDocuments(page: Page): Promise<void> {
  await expect(page.getByTestId('files-modal')).toBeAttached({
    timeout: 10_000,
  })
  await page.getByTestId('chat-input-tools-trigger').click()

  const libraryAction = page
    .getByTestId('chat-input-tools-panel')
    .getByTestId('tools-action-library')

  await expect(libraryAction).toBeVisible()
  await libraryAction.click()
  await expect(page.getByTestId('files-modal')).toBeVisible()
  await page.getByRole('radio', {
    name: 'Select existing files',
    exact: true,
  }).check()
  await page.getByTestId('files-source-assistant').click()
  await page.getByTestId('files-kind-document').click()
}

test.describe('create_document', () => {
  test('shows the card, previews the outline, downloads a docx and lists it '
    + 'in the file manager', async ({ page }) => {
    await signInWithDocuments(page)
    await openDocumentChat(page)

    const statusPromise = watchDocumentStatus(page)

    await sendMessage(page, 'Write me a quarterly update document')

    const card = page.getByTestId('document-card')

    await test.step('shows the card while the document is built', async () => {
      await expect(card).toHaveAttribute(
        'data-state',
        /^(streaming|building)$/,
        { timeout: 20_000 },
      )
      await expect(card).toHaveAttribute('data-format', 'docx')
      await expect(card.getByTestId('document-card-title')).toHaveText(
        TEST_DOCUMENT_TITLE,
      )
      await expect(card.getByTestId('document-card-status')).toBeVisible()
    })

    await test.step('turns ready with a client-rendered file', async () => {
      await expect(card).toHaveAttribute('data-state', 'ready', {
        timeout: READY_TIMEOUT,
      })
      await expect(card.getByTestId('document-card-status')).toHaveText(
        'Ready',
      )

      const initialStatus = await statusPromise
      const status = await fetchDocumentStatus(page, initialStatus.id)

      expect(status.status).toBe('ready')
      expect(status.renderedBy).toBe('client')
      expect(status.errorCode).toBeNull()
      expect(status.file?.name).toBe(FILE_NAME)
    })

    await test.step('opens the preview with the document outline',
      async () => {
        await card.getByTestId('document-card-preview').click()

        const preview = page.getByTestId('document-preview')

        await expect(preview).toBeVisible()
        await expect(preview.getByTestId('document-preview-title'))
          .toHaveText(TEST_DOCUMENT_TITLE)

        const outline = preview.getByTestId('document-preview-outline')

        await expect(outline).toBeVisible({ timeout: 20_000 })

        for (const heading of TEST_DOCUMENT_HEADINGS) {
          await expect(
            outline.getByTestId('document-block-heading').filter({
              hasText: heading,
            }),
          ).toBeVisible()
        }

        await expect(outline.getByTestId('document-block-list')).toBeVisible()
        await expect(outline.getByTestId('document-block-table'))
          .toBeVisible()
      })

    await test.step('downloads a ZIP named after the title', async () => {
      await expectDownloadIsZip(page, card.getByTestId('document-card-download'))
    })

    await test.step('lists the file under Documents in the file manager',
      async () => {
        await openGeneratedDocuments(page)

        await expect(
          page.getByTestId('files-modal').locator(`[title="${FILE_NAME}"]`)
            .first(),
        ).toBeVisible({ timeout: 15_000 })
      })
  })

  test('keeps the card ready after a page reload', async ({ page }) => {
    await signInWithDocuments(page)
    await page.goto(PERSISTED_DOCUMENT_URL)
    await waitForHydration(page)

    const card = page.getByTestId('document-card')

    await expect(card).toHaveAttribute('data-state', 'ready', {
      timeout: READY_TIMEOUT,
    })

    await page.reload()
    await waitForHydration(page)

    await expect(card).toHaveAttribute('data-state', 'ready', {
      timeout: READY_TIMEOUT,
    })
    await expect(card.getByTestId('document-card-title')).toHaveText(
      TEST_DOCUMENT_TITLE,
    )
    await expectDownloadIsZip(page, card.getByTestId('document-card-download'))
  })

  test('falls back to the server render when the client render fails',
    async ({ page }) => {
      await page.addInitScript(() => {
        function BlockedWorker() {
          throw new Error('e2e: the render worker is blocked')
        }

        window.Worker = BlockedWorker as unknown as typeof Worker
      })

      await signInWithDocuments(page)
      await openDocumentChat(page)

      const statusPromise = watchDocumentStatus(page)
      const renderRequestPromise = page.waitForRequest((request) => {
        return request.method() === 'POST'
          && DOCUMENT_RENDER_PATTERN.test(request.url())
      })

      await sendMessage(page, 'Write me a quarterly update document')

      const card = page.getByTestId('document-card')

      await expect(card).toHaveAttribute('data-state', 'ready', {
        timeout: READY_TIMEOUT,
      })
      await renderRequestPromise

      const initialStatus = await statusPromise
      const status = await fetchDocumentStatus(page, initialStatus.id)

      expect(status.status).toBe('ready')
      expect(status.renderedBy).toBe('worker')
      expect(status.errorCode).toBeNull()
      expect(status.file?.name).toBe(FILE_NAME)

      await expectDownloadIsZip(
        page,
        card.getByTestId('document-card-download'),
      )
    })
})
