import { execFileSync } from 'node:child_process'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const TEST_CHAT_ID = 'test-chat-short'
const ARTIFACT_ID = 'E2eShareArtifact1'
const TOOL_CALL_ID = 'call_e2e_share'
const ARTIFACT_TITLE = 'Capitals quiz'
const ARTIFACT_TEXT = 'What is the capital of Poland?'
const ARTIFACT_CONTENT = [
  '<!doctype html>',
  '<html><body>',
  `<h1 id="question">${ARTIFACT_TEXT}</h1>`,
  '</body></html>',
].join('\n')
const SHARE_TOKEN = 'e2eShareToken_0123456789abcdefghijklmnopqrs'
const SHARE_ID = 'sh_e2e1'
const SHARE_PATH = `/artifacts/${SHARE_TOKEN}`
const SHARE_RETURN_STORAGE_KEY = 'artifacts:share-return'
const SHARE_HEADER = 'x-besidka-artifact-share'
const TURNSTILE_TOKEN = 'e2e-turnstile-token'
const CREATED_AT = '2026-11-09T10:00:00.000Z'

const ARTIFACT_OUTPUT = {
  artifactId: ARTIFACT_ID,
  version: 1,
  kind: 'html',
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

const FAKE_TURNSTILE_SCRIPT = `
window.turnstile = {
  render(element, options) {
    window.__e2eTurnstile = options
    return 'e2e-widget'
  },
  execute() {
    setTimeout(() => {
      window.__e2eTurnstile.callback('${TURNSTILE_TOKEN}')
    }, 0)
  },
  reset() {},
  remove() {},
}
`

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
    kind: 'html',
    title: ARTIFACT_TITLE,
    content: ARTIFACT_CONTENT,
  }

  return [
    { type: 'start', messageId: 'assistant-e2e-share' },
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
    { type: 'text-delta', id: 'text-1', delta: 'Here is your quiz.' },
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

interface ShareState {
  revoked: boolean
}

function shareSummary(baseUrl: string, state: ShareState) {
  return {
    shareId: SHARE_ID,
    url: state.revoked ? null : `${baseUrl}${SHARE_PATH}`,
    createdVia: 'ui',
    clientName: null,
    pinnedVersion: null,
    expiresAt: '2026-11-16T10:00:00.000Z',
    revokedAt: state.revoked ? CREATED_AT : null,
    takedownAt: null,
    storageAllowed: false,
    bridgeAllowed: false,
    createdAt: CREATED_AT,
    status: state.revoked ? 'revoked' : 'active',
  }
}

async function mockOwnerRoutes(page: Page, state: ShareState) {
  const sharesUrl = `**/api/v1/artifacts/${ARTIFACT_ID}/shares`

  await mockChatStream(page)
  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await fulfillJson(route, { keys: [{ provider: 'google', hasKey: true }] })
  })
  await page.route(`**/api/v1/artifacts/${ARTIFACT_ID}`, async (route) => {
    await fulfillJson(route, {
      id: ARTIFACT_ID,
      title: ARTIFACT_TITLE,
      kind: 'html',
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
    const origin = new URL(route.request().url()).origin

    if (route.request().method() === 'POST') {
      state.revoked = false
      await fulfillJson(route, {
        share: shareSummary(origin, state),
        url: `${origin}${SHARE_PATH}`,
      })

      return
    }

    await fulfillJson(route, { shares: [shareSummary(origin, state)] })
  })
  await page.route(
    `${sharesUrl}/${SHARE_ID}/revoke`,
    async (route) => {
      state.revoked = true
      await fulfillJson(route, { revoked: 1 })
    },
  )
}

interface ViewerRequests {
  current: string[]
  reports: Array<{ headers: Record<string, string>, body: unknown }>
  storageOrBridge: string[]
}

async function mockViewerRoutes(
  context: BrowserContext,
  state: ShareState,
): Promise<ViewerRequests> {
  const requests: ViewerRequests = {
    current: [],
    reports: [],
    storageOrBridge: [],
  }

  await context.route('https://challenges.cloudflare.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: FAKE_TURNSTILE_SCRIPT,
    })
  })
  await context.route(
    '**/api/v1/artifact-shares/current/report',
    async (route) => {
      requests.reports.push({
        headers: route.request().headers(),
        body: route.request().postDataJSON(),
      })
      await fulfillJson(route, { ok: true })
    },
  )
  await context.route('**/api/v1/artifact-shares/current', async (route) => {
    requests.current.push(route.request().headers()[SHARE_HEADER] ?? '')

    if (state.revoked) {
      await fulfillJson(route, {
        statusCode: 404,
        message: 'Artifact not found',
      }, 404)

      return
    }

    await fulfillJson(route, {
      shareId: SHARE_ID,
      artifactId: ARTIFACT_ID,
      title: ARTIFACT_TITLE,
      kind: 'html',
      version: 1,
      pinned: false,
      content: ARTIFACT_CONTENT,
      createdAt: CREATED_AT,
      expiresAt: '2026-11-16T10:00:00.000Z',
      capabilities: { storageAllowed: true, bridgeAllowed: true },
    })
  })
  await context.route(
    /\/api\/v1\/artifacts\/[^/]+\/(storage|bridge|complete)/,
    async (route) => {
      requests.storageOrBridge.push(route.request().url())
      await route.abort()
    },
  )

  return requests
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

  await input.fill('Make a capitals quiz')
  await input.press('Enter')

  const card = page.getByTestId('artifact-card')

  await expect(card).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  })
  await card.click()
  await expect(page.getByTestId('side-panel')).toBeVisible()
}

test('owner shares an artifact, a signed-out viewer reports it, and a '
  + 'revoked link is not available', async ({ browser, context, page }) => {
  const state: ShareState = { revoked: false }

  await context.addCookies([CONSENT_COOKIE])
  await signInOwner(page)
  await mockOwnerRoutes(page, state)
  await openArtifactPanel(page)

  await page.getByTestId('artifact-actions').click()
  await page.getByTestId('artifact-action-share').click()

  const shareModal = page.getByTestId('artifact-share-modal')

  await expect(shareModal).toBeVisible()
  await expect(page.getByTestId('artifact-share-privacy-note'))
    .toHaveText('Anyone with the link can see this artifact. Viewers can '
      + 'report it.')
  await expect(page.getByTestId('artifact-share-pii-reminder')).toBeVisible()
  await page.getByTestId('artifact-share-storage').check()
  await page.getByTestId('artifact-share-create').click()

  const linkInput = page.getByTestId('artifact-share-link-input')

  await expect(linkInput).toHaveValue(new RegExp(`${SHARE_PATH}$`))
  await expect(page.getByTestId(`artifact-share-row-${SHARE_ID}`))
    .toContainText('Active')

  const viewerContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
  })

  await viewerContext.addCookies([CONSENT_COOKIE])

  const viewerRequests = await mockViewerRoutes(viewerContext, state)
  const viewer = await viewerContext.newPage()
  const requestedUrls: string[] = []

  viewer.on('request', (request) => {
    requestedUrls.push(request.url())
  })

  await viewer.goto(SHARE_PATH)
  await waitForHydration(viewer)

  const banner = viewer.getByTestId('artifact-share-banner')

  await expect(banner).toBeVisible()
  await expect(banner).toContainText(
    'AI-generated by a Besidka user, not reviewed by Besidka.',
  )
  await expect(banner).toContainText(
    'Never enter passwords or payment details here.',
  )
  await expect(viewer.getByTestId('artifact-share-sign-in')).toBeVisible()
  await expect(viewer.locator('meta[name="robots"]'))
    .toHaveAttribute('content', 'noindex, nofollow')
  await expect(viewer.locator('meta[name="ai-generated"]'))
    .toHaveAttribute('content', 'true')
  await expect(
    viewer.frameLocator('[data-testid="artifact-frame-iframe"]')
      .locator('#question'),
  ).toHaveText(ARTIFACT_TEXT, { timeout: 20_000 })

  expect(viewerRequests.current.at(-1)).toBe(SHARE_TOKEN)

  await viewer.getByTestId('artifact-share-report').click()

  const reportModal = viewer.getByTestId('artifact-report-modal')

  await expect(reportModal).toBeVisible()
  await viewer.getByTestId('artifact-report-reason-phishing').check()
  await viewer.getByTestId('artifact-report-details')
    .fill('It asks visitors for their bank password.')
  await viewer.getByTestId('artifact-report-name').fill('Ann Viewer')
  await viewer.getByTestId('artifact-report-email')
    .fill('ann.viewer@example.com')
  await viewer.getByTestId('artifact-report-good-faith').check()
  await viewer.getByTestId('artifact-report-submit').click()

  await expect(viewer.getByTestId('artifact-report-success')).toBeVisible()
  expect(viewerRequests.reports).toHaveLength(1)
  expect(viewerRequests.reports[0]!.headers[SHARE_HEADER]).toBe(SHARE_TOKEN)
  expect(viewerRequests.reports[0]!.body).toMatchObject({
    reason: 'phishing',
    reporterName: 'Ann Viewer',
    reporterEmail: 'ann.viewer@example.com',
    goodFaith: true,
  })
  await viewer.getByTestId('artifact-report-done').click()
  await expect(viewer.getByTestId('artifact-share-report')).toBeFocused()
  expect(viewerRequests.storageOrBridge).toEqual([])

  await viewer.getByTestId('artifact-share-sign-in').locator('a').click()
  await expect(viewer).toHaveURL(
    /\/signin\?next=(%2F|\/)artifacts(%2F|\/)return$/,
  )
  expect(await viewer.evaluate((key) => {
    return window.sessionStorage.getItem(key)
  }, SHARE_RETURN_STORAGE_KEY)).toBe(SHARE_TOKEN)

  await viewer.goto('/artifacts/return')
  await waitForHydration(viewer)
  await expect(viewer).toHaveURL(new RegExp(`/artifacts/${SHARE_TOKEN}$`))
  await expect(viewer.getByTestId('artifact-share-banner')).toBeVisible()
  expect(await viewer.evaluate((key) => {
    return window.sessionStorage.getItem(key)
  }, SHARE_RETURN_STORAGE_KEY)).toBeNull()

  await page.getByTestId('artifact-share-revoke').click()
  await page.getByTestId('confirmation-action-0').click()
  await expect(page.getByTestId(`artifact-share-row-${SHARE_ID}`))
    .toContainText('Turned off')

  await viewer.reload()
  await waitForHydration(viewer)
  await expect(viewer.getByTestId('artifact-share-not-found'))
    .toContainText('This link is not available')
  await expect(viewer.getByTestId('artifact-frame-iframe')).toHaveCount(0)

  const apiUrlsWithToken = requestedUrls.filter((requestedUrl) => {
    const { pathname, search } = new URL(requestedUrl)

    return pathname.startsWith('/api/')
      && `${pathname}${search}`.includes(SHARE_TOKEN)
  })

  expect(requestedUrls.length).toBeGreaterThan(0)
  expect(apiUrlsWithToken).toEqual([])

  const oldFormResponse = await viewer.goto(`/a#${SHARE_TOKEN}`)

  expect(oldFormResponse?.status()).toBe(404)

  await viewerContext.close()
})
