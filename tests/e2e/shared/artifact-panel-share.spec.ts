import { execFileSync } from 'node:child_process'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const TEST_CHAT_ID = 'test-chat-short'
const ARTIFACT_ID = 'E2ePanelShareArt1'
const TOOL_CALL_ID = 'call_e2e_panel_share'
const ARTIFACT_TITLE = 'Order flow'
const ARTIFACT_CONTENT = 'graph TD; Cart-->Checkout'
const CREATED_AT = '2026-11-09T10:00:00.000Z'

const ARTIFACT_OUTPUT = {
  artifactId: ARTIFACT_ID,
  version: 1,
  kind: 'mermaid',
  title: ARTIFACT_TITLE,
}

const VERSION_CONTENT = {
  ...ARTIFACT_OUTPUT,
  content: ARTIFACT_CONTENT,
  sizeBytes: ARTIFACT_CONTENT.length,
  createdAt: CREATED_AT,
}

const CONSENT_COOKIE = {
  name: 'cookies_consent',
  value: JSON.stringify({
    v: 2,
    granted: ['necessary', 'preferences'],
    id: 'e2e-consent',
    date: new Date().toISOString(),
  }),
  domain: 'localhost',
  path: '/',
}

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
})

test.describe.configure({ mode: 'serial', timeout: 120_000 })

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

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'private, no-store' },
    body: JSON.stringify(json),
  })
}

function buildArtifactChunks(): unknown[] {
  const input = {
    kind: 'mermaid',
    title: ARTIFACT_TITLE,
    content: ARTIFACT_CONTENT,
  }

  return [
    { type: 'start', messageId: 'assistant-e2e-panel-share' },
    { type: 'start-step' },
    {
      type: 'tool-input-available',
      toolCallId: TOOL_CALL_ID,
      toolName: 'create_artifact',
      input,
    },
    {
      type: 'tool-output-available',
      toolCallId: TOOL_CALL_ID,
      output: ARTIFACT_OUTPUT,
    },
    { type: 'finish-step' },
    { type: 'start-step' },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'Here is your diagram.' },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish-step' },
    { type: 'finish' },
  ]
}

/**
 * Streams the chat POST from inside the page, as the artifacts panel spec
 * does: the chat client reads the body incrementally.
 */
async function mockChatStream(page: Page) {
  await page.addInitScript((chunks) => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : input.url
      const method = init?.method
        ?? (input instanceof Request ? input.method : 'GET')

      if (!url.includes('/api/v1/chats/test') || method !== 'POST') {
        return originalFetch(input, init)
      }

      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            await new Promise((resolve) => {
              setTimeout(resolve, 50)
            })
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
            )
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })

      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      })
    }
  }, buildArtifactChunks())
}

async function mockOwnerRoutes(page: Page) {
  const sharesUrl = `**/api/v1/artifacts/${ARTIFACT_ID}/shares`

  await mockChatStream(page)
  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await fulfillJson(route, { keys: [{ provider: 'google', hasKey: true }] })
  })
  await page.route(`**/api/v1/artifacts/${ARTIFACT_ID}`, async (route) => {
    await fulfillJson(route, {
      id: ARTIFACT_ID,
      title: ARTIFACT_TITLE,
      kind: 'mermaid',
      currentVersion: 1,
      versionCount: 1,
      updatedAt: CREATED_AT,
      originChatSlug: null,
      createdVia: 'chat',
      activeShareCount: 0,
      takenDown: false,
      totalBytes: VERSION_CONTENT.sizeBytes,
      createdAt: CREATED_AT,
      versions: [{
        version: 1,
        sizeBytes: VERSION_CONTENT.sizeBytes,
        createdBy: 'model',
        createdAt: CREATED_AT,
      }],
    })
  })
  await page.route(
    `**/api/v1/artifacts/${ARTIFACT_ID}/versions/1`,
    async (route) => {
      await fulfillJson(route, VERSION_CONTENT)
    },
  )
  await page.route(`${sharesUrl}/check`, async (route) => {
    await fulfillJson(route, { warnings: [] })
  })
  await page.route(sharesUrl, async (route) => {
    await fulfillJson(route, { shares: [] })
  })
}

async function signInOwner(page: Page) {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }

  await authenticateUserByApi(page, admin)
  markEmailVerified(E2E_ADMIN_EMAIL)

  const features = await page.request.get('/api/v1/features')
  const payload = await features.json()

  expect(payload.features.artifacts).toMatchObject({ active: true })
  expect(payload.features['artifacts.share']).toMatchObject({ active: true })
}

async function openArtifactPanel(page: Page) {
  await page.addInitScript((chatId) => {
    try {
      window.sessionStorage.setItem(`artifacts:auto-opened:${chatId}`, '1')
    } catch {
      return
    }
  }, TEST_CHAT_ID)
  await page.goto('/chats/test?scenario=short&messages=1')
  await waitForHydration(page)

  const input = page.locator('textarea').first()

  await input.fill('Draw the order flow')
  await input.press('Enter')

  const card = page.getByTestId('artifact-card')

  await expect(card).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  })
  await card.click()
  await expect(page.getByTestId('side-panel')).toBeVisible()
}

test('the panel menu opens the share dialog without closing first',
  async ({ context, page }) => {
    await context.addCookies([CONSENT_COOKIE])
    await signInOwner(page)
    await mockOwnerRoutes(page)
    await openArtifactPanel(page)

    await page.getByTestId('artifact-actions').click()
    await expect(page.getByTestId('artifact-actions-menu')).toBeVisible()
    await page.getByTestId('artifact-action-share').click()

    const shareModal = page.getByTestId('artifact-share-modal')

    await expect(shareModal).toBeVisible()
    await expect(shareModal).toContainText('Share artifact')
    await expect(shareModal).toContainText(ARTIFACT_TITLE)
  })

test('the share dialog says the link is hidden from search engines',
  async ({ context, page }) => {
    await context.addCookies([CONSENT_COOKIE])
    await signInOwner(page)
    await mockOwnerRoutes(page)
    await openArtifactPanel(page)

    await page.getByTestId('artifact-actions').click()
    await page.getByTestId('artifact-action-share').click()

    const note = page.getByTestId('artifact-share-search-note')

    await expect(note).toBeVisible()
    await expect(note).toHaveClass(/alert-info/)
    await expect(note).toContainText('search engines never show it')
    await expect(page.getByTestId('artifact-share-modal')
      .locator('input[type="checkbox"]')).toHaveCount(2)
  })
