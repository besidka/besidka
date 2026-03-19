import type { Locator, Page } from '@playwright/test'
import { devices, expect, test } from '@playwright/test'

const iPhone12 = devices['iPhone 12']

test.use({
  viewport: iPhone12.viewport,
  screen: iPhone12.screen,
  deviceScaleFactor: iPhone12.deviceScaleFactor,
  isMobile: iPhone12.isMobile,
  hasTouch: iPhone12.hasTouch,
  userAgent: iPhone12.userAgent,
})

const chatSlug = '01JQMTESTCHAT0000000000001'

const chatResponse = {
  id: 'chat-id-1',
  slug: chatSlug,
  title: 'Test Chat',
  projectId: null,
  messages: [
    {
      id: 'msg-user-1',
      publicId: 'msg-user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello, world!' }],
      tools: [],
      reasoning: 'off',
    },
    {
      id: 'msg-assistant-1',
      publicId: 'msg-assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello! How can I help you today?' }],
      tools: [],
      reasoning: 'off',
    },
  ],
}

async function setupChatMocks(page: Page): Promise<void> {
  await page.route(`**/api/v1/chats/${chatSlug}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(chatResponse),
    })
  })

  await page.route('**/api/v1/chats/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pinned: [], chats: [], nextCursor: null }),
    })
  })
}

async function longPress(locator: Locator): Promise<void> {
  const box = await locator.boundingBox()

  if (!box) {
    throw new Error('Element has no bounding box')
  }

  const page = locator.page()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y)

      if (!target) return

      target.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
        composed: true,
      }))
    },
    { x, y },
  )

  await page.waitForTimeout(600)

  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y)

      if (!target) return

      target.dispatchEvent(new PointerEvent('pointerup', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
        composed: true,
      }))
    },
    { x, y },
  )
}

async function quickTap(locator: Locator): Promise<void> {
  const box = await locator.boundingBox()

  if (!box) {
    throw new Error('Element has no bounding box')
  }

  const page = locator.page()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y)

      if (!target) return

      target.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
        composed: true,
      }))
      target.dispatchEvent(new PointerEvent('pointerup', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
        composed: true,
      }))
    },
    { x, y },
  )
}

test.describe('chat context menu (touch)', () => {
  test.beforeEach(async ({ page }) => {
    await setupChatMocks(page)
    await page.goto('/chats/new')

    await page.waitForFunction(() => {
      const root = document.querySelector('#__nuxt') as any

      return Boolean(root?.__vue_app__)
    })

    await page.evaluate((slug) => {
      const root = document.querySelector('#__nuxt') as any
      const router = root.__vue_app__.config.globalProperties.$router

      return router.push(`/chats/${slug}`)
    }, chatSlug)

    await page.waitForSelector('[data-role="assistant"]')
  })

  test('long-press opens context menu', async ({ page }) => {
    const assistantMessage = page
      .locator('[data-role="assistant"]')
      .first()

    await expect(assistantMessage).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()
  })

  test('quick tap dismisses context menu', async ({ page }) => {
    const assistantMessage = page
      .locator('[data-role="assistant"]')
      .first()

    await expect(assistantMessage).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()

    const userMessage = page.locator('[data-role="user"]').first()

    await quickTap(userMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeHidden()
  })

  test('quick tap on selected message does not dismiss context menu', async ({ page }) => {
    const assistantMessage = page
      .locator('[data-role="assistant"]')
      .first()

    await expect(assistantMessage).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()

    await quickTap(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()
  })

  test('long-press on selected message does not reopen context menu', async ({ page }) => {
    const assistantMessage = page
      .locator('[data-role="assistant"]')
      .first()

    await expect(assistantMessage).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'New chat from here' }),
    ).toBeVisible()
  })
})
