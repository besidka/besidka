import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

interface ChatInputBottomMetrics {
  isCollapsed: boolean
  chatInputBottom: number
  viewportHeight: number
  distanceFromScrollBottom: number
}

const TEXTAREA = 'textarea[placeholder="Type your message here..."]'
const TOOLS_TRIGGER = '[data-testid="chat-input-tools-trigger"]'
const TOOLS_PANEL = '[data-testid="chat-input-tools-panel"]'
const SEARCH_TILE_BODY = '[data-testid="chat-input-tile-search-body"]'
const DESKTOP_COLLAPSED_CLASS
  = 'sm:translate-y-[calc(100%-var(--spacing)_*_14)]'
const AT_BOTTOM_TOLERANCE_PX = 1
const UPLOAD_DELAY_MS = 300
const SETTLE_AFTER_RESIZE_MS = 1_000
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
  + 'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test.use({ viewport: { width: 1280, height: 800 } })

test.describe.configure({ timeout: 45_000 })

test.beforeEach(async ({ page, context }) => {
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

  await page.addInitScript(() => {
    window.localStorage.setItem('settings_web_search_tool', 'off')
  })

  await page.route(/\/api\/v1\/files\/upload(?:\?.*)?$/, async (route) => {
    const headers = route.request().headers()
    const filename = decodeURIComponent(headers['x-filename'] || 'file.png')
    const now = new Date().toISOString()
    const id = `mock-${Date.now()}`

    await new Promise(resolve => setTimeout(resolve, UPLOAD_DELAY_MS))

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id,
        userId: 1,
        storageKey: `users/1/mock/${id}-${filename}`,
        name: filename,
        size: Number(headers['x-filesize'] || 0),
        type: headers['content-type'] || 'image/png',
        source: 'upload',
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    })
  })
})

async function getChatInputBottomMetrics(
  page: Page,
): Promise<ChatInputBottomMetrics> {
  return page.evaluate((desktopCollapsedClass) => {
    const textarea = document.querySelector(
      'textarea[placeholder="Type your message here..."]',
    )
    const chatInput = textarea?.closest('.fixed') as HTMLElement | null
    const scrollContainer = document.querySelector(
      '[data-testid="chat-messages-container"]',
    )?.closest('.overflow-y-auto') as HTMLElement | null

    if (!chatInput || !scrollContainer) {
      throw new Error('Chat input or scroll container is missing')
    }

    return {
      isCollapsed: chatInput.classList.contains(desktopCollapsedClass),
      chatInputBottom: chatInput.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      distanceFromScrollBottom: scrollContainer.scrollHeight
        - scrollContainer.scrollTop
        - scrollContainer.clientHeight,
    }
  }, DESKTOP_COLLAPSED_CLASS)
}

async function getChatInputHeight(page: Page): Promise<number> {
  return page.locator(TEXTAREA).evaluate((textarea) => {
    const chatInput = textarea.closest('.fixed') as HTMLElement | null

    return chatInput?.offsetHeight ?? 0
  })
}

async function expectChatInputFullyShownAtBottom(page: Page): Promise<void> {
  await expect.poll(async () => {
    const metrics = await getChatInputBottomMetrics(page)

    return !metrics.isCollapsed
      && metrics.chatInputBottom
      <= metrics.viewportHeight + AT_BOTTOM_TOLERANCE_PX
      && metrics.distanceFromScrollBottom <= AT_BOTTOM_TOLERANCE_PX
  }, { timeout: 5_000 }).toBe(true)

  const metrics = await getChatInputBottomMetrics(page)

  expect(metrics.isCollapsed).toBe(false)
  expect(metrics.chatInputBottom)
    .toBeLessThanOrEqual(metrics.viewportHeight + AT_BOTTOM_TOLERANCE_PX)
  expect(metrics.distanceFromScrollBottom)
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE_PX)
}

async function selectBuiltInWebSearch(page: Page): Promise<void> {
  await page.locator(TOOLS_TRIGGER).click()
  await page.locator(TOOLS_PANEL)
    .locator('[data-testid="web-search-option-web_search"]')
    .check()
  await page.keyboard.press('Escape')

  await expect(page.locator(TOOLS_PANEL)).toBeHidden()
  await expect(page.locator(SEARCH_TILE_BODY))
    .toHaveAttribute('data-variant', 'pill')
}

async function scrollConversationToBottom(page: Page): Promise<void> {
  await page.getByTestId('chat-messages-container').hover()
  await page.mouse.wheel(0, 5_000)

  await expect.poll(async () => {
    const metrics = await getChatInputBottomMetrics(page)

    return metrics.distanceFromScrollBottom <= AT_BOTTOM_TOLERANCE_PX
  }).toBe(true)

  await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS)
  await expectChatInputFullyShownAtBottom(page)
}

async function attachImageViaUploadModal(page: Page): Promise<void> {
  await page.locator(TOOLS_TRIGGER).click()
  await page.locator(TOOLS_PANEL).getByTestId('tools-action-attach').click()

  await expect(page.getByTestId('files-modal')).toBeVisible()

  await page.getByRole('radio', { name: 'Upload new files', exact: true })
    .check()
  await page.getByTestId('files-upload-input').setInputFiles({
    name: 'collapse-check.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
}

test.describe('Chat input stays shown when an attachment grows it', () => {
  test('attaching a file next to a pill tile keeps a bottom-scrolled '
    + 'desktop input fully visible', async ({ page }) => {
    await page.goto('/chats/test?scenario=short&messages=30')
    await waitForHydration(page)

    await expect(page.locator(TEXTAREA)).toBeVisible()

    await selectBuiltInWebSearch(page)
    await scrollConversationToBottom(page)

    const chatInputHeightBefore = await getChatInputHeight(page)

    await attachImageViaUploadModal(page)

    await expect(page.getByTestId('files-modal')).toBeHidden()
    await expect(page.locator(SEARCH_TILE_BODY))
      .toHaveAttribute('data-variant', 'square')
    await expect(page.getByTestId('carousel-item')).toHaveCount(1)
    await expect.poll(async () => {
      return getChatInputHeight(page)
    }).toBeGreaterThan(chatInputHeightBefore)

    await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS)

    await expectChatInputFullyShownAtBottom(page)
  })
})
