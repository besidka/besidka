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
const ARTIFACT_ID = 'E2ePanelArtifact'
const TOOL_CALL_ID = 'call_e2e_panel'
const SHARE_SLUG = 'e2e-share-artifacts'
const ARTIFACT_TITLE = 'Greeting page'
const ARTIFACT_TEXT = 'Hello from the artifact runtime'
const ARTIFACT_CONTENT = [
  '<!doctype html>',
  '<html><body>',
  `<h1 id="greeting">${ARTIFACT_TEXT}</h1>`,
  '</body></html>',
].join('\n')
const SCROLL_TOLERANCE_PX = 4
const PANEL_SETTLE_MS = 600
const STREAM_CHUNK_DELAY_MS = 150

const CODE_BLOCK_SOURCE = 'const answer: number = 42'
const DIAGRAM_SOURCE = 'graph TD\n  Start --> Done'
const CODE_BLOCKS_CONTENT = [
  '<!doctype html>',
  '<html><body>',
  `<pre><code class="language-ts">${CODE_BLOCK_SOURCE}</code></pre>`,
  `<pre><code class="language-mermaid">${DIAGRAM_SOURCE}</code></pre>`,
  '</body></html>',
].join('\n')

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
  createdAt: '2026-11-08T12:00:00.000Z',
}

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
})

test.describe.configure({ mode: 'serial', timeout: 90_000 })

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

async function sendMessage(page: Page, message: string) {
  const input = page.locator('textarea').first()

  await input.fill(message)
  await input.press('Enter')
}

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

function buildArtifactChunks(): unknown[] {
  const input = {
    kind: 'html',
    title: ARTIFACT_TITLE,
    content: ARTIFACT_CONTENT,
  }
  const inputJson = JSON.stringify(input)
  const middle = Math.floor(inputJson.length / 2)

  return [
    { type: 'start', messageId: 'assistant-e2e-artifact' },
    { type: 'start-step' },
    {
      type: 'tool-input-start',
      toolCallId: TOOL_CALL_ID,
      toolName: 'create_artifact',
    },
    {
      type: 'tool-input-delta',
      toolCallId: TOOL_CALL_ID,
      inputTextDelta: inputJson.slice(0, middle),
    },
    {
      type: 'tool-input-delta',
      toolCallId: TOOL_CALL_ID,
      inputTextDelta: inputJson.slice(middle),
    },
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
    { type: 'text-delta', id: 'text-1', delta: 'Here is your page.' },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish-step' },
    { type: 'finish' },
  ]
}

async function fulfillJson(route: Route, json: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'private, no-store' },
    body: JSON.stringify(json),
  })
}

/**
 * Streams the chat POST from inside the page, one SSE chunk at a time, so
 * the card goes through its streaming state like a real generation does
 * (`route.fulfill` delivers the whole body at once).
 */
async function mockStreamingChat(page: Page) {
  await page.addInitScript(({ chunks, delayMs }) => {
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
              setTimeout(resolve, delayMs)
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
  }, { chunks: buildArtifactChunks(), delayMs: STREAM_CHUNK_DELAY_MS })
}

async function mockOwnerRoutes(
  page: Page,
  versions: Array<typeof VERSION_CONTENT> = [VERSION_CONTENT],
) {
  await mockStreamingChat(page)
  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await fulfillJson(route, {
      keys: [{ provider: 'google', hasKey: true }],
    })
  })

  await page.route(`**/api/v1/artifacts/${ARTIFACT_ID}`, async (route) => {
    await fulfillJson(route, {
      id: ARTIFACT_ID,
      title: ARTIFACT_TITLE,
      kind: 'html',
      currentVersion: versions.length,
      versionCount: versions.length,
      updatedAt: VERSION_CONTENT.createdAt,
      originChatSlug: null,
      createdVia: 'chat',
      activeShareCount: 0,
      takenDown: false,
      totalBytes: VERSION_CONTENT.sizeBytes,
      createdAt: VERSION_CONTENT.createdAt,
      versions: versions.map((entry) => {
        return {
          version: entry.version,
          sizeBytes: entry.sizeBytes,
          createdBy: 'model',
          createdAt: entry.createdAt,
        }
      }).reverse(),
    })
  })

  for (const entry of versions) {
    await page.route(
      `**/api/v1/artifacts/${ARTIFACT_ID}/versions/${entry.version}`,
      async (route) => {
        await fulfillJson(route, entry)
      },
    )
  }
}

async function mockSharedRoutes(
  page: Page,
  versionContent: typeof VERSION_CONTENT = VERSION_CONTENT,
) {
  await page.route(`**/api/v1/shared/${SHARE_SLUG}`, async (route) => {
    await fulfillJson(route, {
      title: 'Shared artifact chat',
      indexable: false,
      showFiles: false,
      showMetadata: false,
      showAuthorAvatar: false,
      allowBranch: false,
      author: null,
      messages: [
        {
          id: 'shared-user-1',
          role: 'user',
          reasoning: 'off',
          parts: [{ type: 'text', text: 'Make a greeting page' }],
        },
        {
          id: 'shared-assistant-1',
          role: 'assistant',
          reasoning: 'off',
          parts: [
            { type: 'data-artifact', data: ARTIFACT_OUTPUT },
            { type: 'text', text: 'Here is your page.' },
          ],
        },
      ],
    })
  })

  await page.route(
    `**/api/v1/shared/${SHARE_SLUG}/artifacts/${ARTIFACT_ID}/versions/1`,
    async (route) => {
      await fulfillJson(route, versionContent)
    },
  )
}

async function openSharedChat(page: Page) {
  await page.goto('/chats/test?scenario=short&messages=1')
  await waitForHydration(page)

  await page.evaluate((path) => {
    const root = document.querySelector('#__nuxt') as unknown as {
      __vue_app__: {
        config: {
          globalProperties: { $router: { push: (to: string) => unknown } }
        }
      }
    }

    return root.__vue_app__.config.globalProperties.$router.push(path)
  }, `/shared/${SHARE_SLUG}`)
}

async function signInWithArtifacts(page: Page) {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }

  await authenticateUserByApi(page, admin)
  markEmailVerified(E2E_ADMIN_EMAIL)

  const features = await page.request.get('/api/v1/features')

  expect((await features.json()).features.artifacts).toMatchObject({
    active: true,
  })
}

async function getMessageTop(page: Page, messageId: string) {
  return page.evaluate((id) => {
    const element = document.querySelector(
      `[data-message-id="${CSS.escape(id)}"]`,
    )

    return element?.getBoundingClientRect().top ?? null
  }, messageId)
}

async function openStreamedArtifactPanel(
  page: Page,
  versions: Array<typeof VERSION_CONTENT> = [VERSION_CONTENT],
): Promise<string> {
  await signInWithArtifacts(page)
  await mockOwnerRoutes(page, versions)
  await page.addInitScript((chatId) => {
    window.sessionStorage.setItem(`artifacts:auto-opened:${chatId}`, '1')
  }, TEST_CHAT_ID)
  await page.goto('/chats/test?scenario=short&messages=1')
  await waitForHydration(page)
  await sendMessage(page, 'Make a greeting page')

  const card = page.getByTestId('artifact-card')

  await expect(card).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  })
  await expect(page.getByText('Here is your page.')).toBeVisible({
    timeout: 20_000,
  })

  const messageId = await card.evaluate((element) => {
    return element.closest('[data-message-id]')?.getAttribute(
      'data-message-id',
    ) ?? ''
  })

  await card.click()
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await expect(page.getByTestId('artifact-frame')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 20_000 },
  )
  await page.waitForTimeout(PANEL_SETTLE_MS)

  return messageId
}

async function selectMessageMenu(page: Page, messageId: string) {
  await page.evaluate((id) => {
    const testWindow = window as typeof window & {
      __besidkaChatTest: { selectMessage: (messageId: string) => void }
    }

    testWindow.__besidkaChatTest.selectMessage(id)
  }, messageId)
}

async function readSeamState(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="side-panel"]')
    const pill = document.querySelector('[data-testid="sidebar"]')
    const panelBox = panel?.getBoundingClientRect()
    const pillBox = pill?.getBoundingClientRect()

    return {
      inset: document.documentElement.style.getPropertyValue(
        '--side-panel-width',
      ),
      panel: panelBox
        ? { x: panelBox.x, width: panelBox.width }
        : null,
      pill: pillBox ? { x: pillBox.x, width: pillBox.width } : null,
      pillDocked: pill?.getAttribute('data-docked') === 'true',
      shellInert: !!document.querySelector('.side-panel-inset[inert]'),
    }
  })
}

async function markPreviewFrame(page: Page) {
  await page.getByTestId('artifact-frame-iframe').evaluate((element) => {
    (element as HTMLElement & { __marker?: number }).__marker = 1
  })
}

async function isPreviewFrameMarked(page: Page): Promise<boolean> {
  return page.getByTestId('artifact-frame-iframe').evaluate((element) => {
    return (element as HTMLElement & { __marker?: number }).__marker === 1
  })
}

function trackReloads(page: Page) {
  const tracker = { frameNavigations: 0, versionRequests: 0 }

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) {
      tracker.frameNavigations += 1
    }
  })
  page.on('request', (request) => {
    if (request.url().includes('/versions/')) {
      tracker.versionRequests += 1
    }
  })

  return tracker
}

function getPreviewFrame(page: Page) {
  return page.frameLocator('[data-testid="artifact-frame-iframe"]')
}

test('opens a streamed artifact in the side panel and renders it in the '
  + 'sandboxed runtime', async ({ page }) => {
  await signInWithArtifacts(page)
  await mockOwnerRoutes(page)
  await page.addInitScript((chatId) => {
    try {
      window.sessionStorage.setItem(`artifacts:auto-opened:${chatId}`, '1')
    } catch {
      return
    }
  }, TEST_CHAT_ID)

  await page.goto('/chats/test?scenario=short&messages=1')
  await waitForHydration(page)

  await sendMessage(page, 'Make a greeting page')

  const card = page.getByTestId('artifact-card')

  await expect(card).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  })
  await expect(card).toHaveAttribute('aria-label', `Open ${ARTIFACT_TITLE}`)
  await expect(card).toBeVisible()
  await expect(page.getByText('Here is your page.')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('side-panel')).toHaveCount(0)

  const messageId = await card.evaluate((element) => {
    return element.closest('[data-message-id]')?.getAttribute(
      'data-message-id',
    ) ?? ''
  })
  const topBefore = await getMessageTop(page, messageId)

  await card.click()

  const panel = page.getByTestId('side-panel')

  await expect(panel).toBeVisible()
  await expect(page.getByTestId('side-panel-title')).toHaveText(ARTIFACT_TITLE)
  await page.waitForTimeout(PANEL_SETTLE_MS)

  const topAfter = await getMessageTop(page, messageId)

  expect(topBefore).not.toBeNull()
  expect(topAfter).not.toBeNull()
  expect(Math.abs((topAfter ?? 0) - (topBefore ?? 0)))
    .toBeLessThanOrEqual(SCROLL_TOLERANCE_PX)

  const iframe = page.getByTestId('artifact-frame-iframe')

  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  await expect(getPreviewFrame(page).locator('#greeting'))
    .toHaveText(ARTIFACT_TEXT, { timeout: 20_000 })
  await expect(page.getByTestId('artifact-frame')).toHaveAttribute(
    'data-status',
    'ready',
  )

  await page.getByTestId('artifact-tab-code').click()
  await expect(page.getByTestId('artifact-code')).toContainText(ARTIFACT_TEXT)
  await page.getByTestId('artifact-tab-preview').click()
  await expect(getPreviewFrame(page).locator('#greeting'))
    .toHaveText(ARTIFACT_TEXT)

  await expect(page.getByTestId('artifact-ai-note'))
    .toHaveText('AI-generated content')

  await page.getByTestId('side-panel-close').click()
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
})

test('auto-opens the first streamed artifact once per chat', async ({
  page,
}) => {
  await signInWithArtifacts(page)
  await mockOwnerRoutes(page)

  await page.goto('/chats/test?scenario=short&messages=1')
  await waitForHydration(page)
  await sendMessage(page, 'Make a greeting page')

  await expect(page.getByTestId('artifact-card')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 20_000 },
  )

  const marker = await page.evaluate((chatId) => {
    return window.sessionStorage.getItem(`artifacts:auto-opened:${chatId}`)
  }, TEST_CHAT_ID)

  expect(marker).toBe('1')
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await expect(getPreviewFrame(page).locator('#greeting'))
    .toHaveText(ARTIFACT_TEXT, { timeout: 20_000 })

  await page.reload()
  await waitForHydration(page)

  const markerAfterReload = await page.evaluate((chatId) => {
    return window.sessionStorage.getItem(`artifacts:auto-opened:${chatId}`)
  }, TEST_CHAT_ID)

  expect(markerAfterReload).toBe('1')

  await sendMessage(page, 'Make a greeting page')
  await expect(page.getByTestId('artifact-card').last()).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 20_000 },
  )
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
})

test('shows shared-chat artifacts read-only', async ({ page }) => {
  await signInWithArtifacts(page)
  await mockSharedRoutes(page)
  await openSharedChat(page)

  const card = page.getByTestId('artifact-card')

  await expect(card).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  })
  await card.click()

  await expect(page.getByTestId('artifact-detail')).toHaveAttribute(
    'data-source',
    'shared',
  )
  await expect(page.getByTestId('artifact-shared-banner'))
    .toContainText('not reviewed by Besidka')
  await expect(page.getByTestId('artifact-report-button')).toBeVisible()
  await expect(page.getByTestId('artifact-ask-to-fix')).toHaveCount(0)
  await expect(page.locator('meta[name="ai-generated"]'))
    .toHaveAttribute('content', 'true')
  await expect(
    page.locator('[data-testid="artifact-version-select"] option'),
  ).toHaveCount(1)
  await expect(getPreviewFrame(page).locator('#greeting'))
    .toHaveText(ARTIFACT_TEXT, { timeout: 20_000 })
})

test('renders artifact code blocks and opens diagrams in the chat viewer',
  async ({ page }) => {
    await signInWithArtifacts(page)
    await mockSharedRoutes(page, {
      ...VERSION_CONTENT,
      content: CODE_BLOCKS_CONTENT,
      sizeBytes: CODE_BLOCKS_CONTENT.length,
    })
    await openSharedChat(page)

    const card = page.getByTestId('artifact-card')

    await expect(card).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000,
    })
    await card.click()

    const preview = getPreviewFrame(page)
    const code = preview.locator('besidka-code')
    const diagram = preview.locator('besidka-mermaid')

    await expect(code).toHaveAttribute('lang', 'ts', { timeout: 20_000 })
    await expect(code.locator('pre.shiki')).toContainText(CODE_BLOCK_SOURCE)
    await expect(code.locator('pre.shiki span[style*="color"]').first())
      .toBeVisible()
    await expect(diagram.getByTestId('besidka-mermaid-diagram').locator('svg')
      .first()).toBeVisible({ timeout: 20_000 })

    await diagram.getByTestId('besidka-mermaid-fullscreen').click()

    const viewer = page.getByTestId('mermaid-viewer')

    await expect(viewer).toBeVisible()
    await expect(page.getByTestId('mermaid-viewer-target').locator('svg'))
      .toBeVisible()

    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    await expect(page.getByTestId('side-panel')).toBeVisible()
  })

test.describe('message context menu focus mode', () => {
  async function expectPanelRestored(
    page: Page,
    before: Awaited<ReturnType<typeof readSeamState>>,
    tracker: ReturnType<typeof trackReloads>,
    counts: { frameNavigations: number, versionRequests: number },
  ) {
    await expect(page.getByTestId('side-panel')).toBeVisible()
    await page.waitForTimeout(PANEL_SETTLE_MS)

    const after = await readSeamState(page)

    expect(after.inset).toBe(before.inset)
    expect(after.panel?.width).toBeCloseTo(before.panel?.width ?? 0, 0)
    expect(after.panel?.x).toBeCloseTo(before.panel?.x ?? 0, 0)
    expect(after.pillDocked).toBe(before.pillDocked)
    await expect(page.getByTestId('artifact-tab-code'))
      .toHaveAttribute('aria-selected', 'true')
    expect(await isPreviewFrameMarked(page)).toBe(true)
    expect(tracker.frameNavigations).toBe(counts.frameNavigations)
    expect(tracker.versionRequests).toBe(counts.versionRequests)
  }

  test('docked at 1440: collapses to the no-panel layout while the menu is '
    + 'open and restores the same panel after', async ({ page }) => {
    const messageId = await openStreamedArtifactPanel(page)

    await page.getByTestId('artifact-tab-code').click()
    await markPreviewFrame(page)

    const tracker = trackReloads(page)
    const before = await readSeamState(page)
    const topBefore = await getMessageTop(page, messageId)

    expect(before.inset).toBe('480px')
    expect(before.pillDocked).toBe(true)

    await selectMessageMenu(page, messageId)
    await expect(page.getByTestId('side-panel')).toBeHidden()
    await expect(page.getByTestId('message-menu-info')).toBeVisible()
    await page.waitForTimeout(PANEL_SETTLE_MS)

    const during = await readSeamState(page)
    const topDuring = await getMessageTop(page, messageId)

    expect(during.inset).toBe('0px')
    expect(during.pillDocked).toBe(false)
    expect(during.panel?.x).toBeGreaterThanOrEqual(1440)
    expect(Math.abs((topDuring ?? 0) - (topBefore ?? 0)))
      .toBeLessThanOrEqual(SCROLL_TOLERANCE_PX)

    const counts = {
      frameNavigations: tracker.frameNavigations,
      versionRequests: tracker.versionRequests,
    }

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('message-menu-info')).toHaveCount(0)
    await expectPanelRestored(page, before, tracker, counts)

    const topAfter = await getMessageTop(page, messageId)

    expect(Math.abs((topAfter ?? 0) - (topBefore ?? 0)))
      .toBeLessThanOrEqual(SCROLL_TOLERANCE_PX)
    await expect(page.getByTestId('side-panel')).toHaveAttribute(
      'data-layout',
      'docked',
    )
  })

  test('other menus leave the docked panel and the pill where they are',
    async ({ page }) => {
      await openStreamedArtifactPanel(page)

      const before = await readSeamState(page)

      await page.getByTestId('chat-input-tools-trigger').click()
      await expect(page.getByTestId('chat-input-tools-panel').first())
        .toBeVisible()
      await page.waitForTimeout(PANEL_SETTLE_MS)

      const during = await readSeamState(page)

      expect(during).toEqual(before)
      await expect(page.getByTestId('side-panel')).toBeVisible()
    })

  test('overlay band: collapses the panel and its scrim, then restores',
    async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 800 })

      const messageId = await openStreamedArtifactPanel(page)

      await page.getByTestId('artifact-tab-code').click()
      await markPreviewFrame(page)

      const tracker = trackReloads(page)
      const before = await readSeamState(page)

      await expect(page.getByTestId('side-panel')).toHaveAttribute(
        'data-layout',
        'overlay',
      )
      await expect(page.getByTestId('side-panel-scrim')).toBeVisible()

      await selectMessageMenu(page, messageId)
      await expect(page.getByTestId('side-panel')).toBeHidden()
      await expect(page.getByTestId('side-panel-scrim')).toHaveCount(0)
      await expect(page.getByTestId('message-menu-info')).toBeVisible()
      expect((await readSeamState(page)).shellInert).toBe(false)

      const counts = {
        frameNavigations: tracker.frameNavigations,
        versionRequests: tracker.versionRequests,
      }

      await page.keyboard.press('Escape')
      await expect(page.getByTestId('message-menu-info')).toHaveCount(0)
      await expectPanelRestored(page, before, tracker, counts)
      await expect(page.getByTestId('side-panel-scrim')).toBeVisible()
      await expect(page.getByTestId('side-panel')).toHaveAttribute(
        'data-layout',
        'overlay',
      )
    })

  test('mobile sheet at 375: hides the sheet while the menu is open and '
    + 'reopens the same one', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    const messageId = await openStreamedArtifactPanel(page)

    await page.getByTestId('artifact-tab-code').click()
    await markPreviewFrame(page)

    const tracker = trackReloads(page)
    const sheet = page.getByTestId('side-panel-sheet')

    await expect(sheet).toHaveAttribute('open', '')

    await selectMessageMenu(page, messageId)
    await expect(sheet).toBeHidden()
    await expect(page.getByTestId('message-menu-info')).toBeVisible()
    await expect(page.getByTestId('artifact-detail')).toHaveCount(1)

    const counts = {
      frameNavigations: tracker.frameNavigations,
      versionRequests: tracker.versionRequests,
    }

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('message-menu-info')).toHaveCount(0)
    await expect(sheet).toHaveAttribute('open', '')
    await expect(page.getByTestId('artifact-tab-code'))
      .toHaveAttribute('aria-selected', 'true')
    expect(await isPreviewFrameMarked(page)).toBe(true)
    expect(tracker.frameNavigations).toBe(counts.frameNavigations)
    expect(tracker.versionRequests).toBe(counts.versionRequests)
  })
})

test.describe('artifact versions and menus', () => {
  const FAILING_CONTENT = [
    '<!doctype html>',
    '<html><body><h1 id="greeting">Broken</h1>',
    '<script>throw new Error("version two exploded")</script>',
    '</body></html>',
  ].join('\n')
  const VERSIONS = [
    VERSION_CONTENT,
    {
      ...VERSION_CONTENT,
      version: 2,
      content: FAILING_CONTENT,
      sizeBytes: FAILING_CONTENT.length,
    },
  ]

  test('shows a runtime error only on the version that raised it',
    async ({ page }) => {
      await openStreamedArtifactPanel(page, VERSIONS)

      const select = page.getByTestId('artifact-version-select')
      const banner = page.getByTestId('artifact-runtime-error')

      await expect(banner).toHaveCount(0)

      await select.selectOption('2')
      await expect(banner).toContainText('version two exploded', {
        timeout: 20_000,
      })

      await select.selectOption('1')
      await expect(banner).toHaveCount(0)
      await expect(getPreviewFrame(page).locator('#greeting'))
        .toHaveText(ARTIFACT_TEXT, { timeout: 20_000 })
      await expect(banner).toHaveCount(0)

      await select.selectOption('2')
      await expect(banner).toContainText('version two exploded', {
        timeout: 20_000,
      })
    })

  test('the actions menu closes when Tab moves focus out of it',
    async ({ page }) => {
      await openStreamedArtifactPanel(page)

      const menu = page.locator('details.dropdown:has('
        + '[data-testid="artifact-actions"])')

      await page.getByTestId('artifact-actions').click()
      await expect(menu).toHaveAttribute('open', '')

      for (let press = 0; press < 12; press += 1) {
        await page.keyboard.press('Tab')

        const isFocusInside = await menu.evaluate((element) => {
          return element.contains(document.activeElement)
        })

        if (!isFocusInside) {
          break
        }
      }

      await expect(menu).not.toHaveAttribute('open', '')
    })
})
