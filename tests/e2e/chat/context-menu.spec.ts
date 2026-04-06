import type { Locator } from '@playwright/test'
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

async function longPress(locator: Locator): Promise<void> {
  const messageId = await locator.getAttribute('data-message-id')

  if (!messageId) {
    throw new Error('Message is missing data-message-id')
  }

  await locator.page().evaluate((id) => {
    ;(window as typeof window & {
      __besidkaChatTest?: {
        selectMessage: (messageId: string) => void
      }
    }).__besidkaChatTest?.selectMessage(id)
  }, messageId)
}

async function quickTap(locator: Locator): Promise<void> {
  const target = locator.locator('.group').first()
  const box = await target.boundingBox()

  if (!box) {
    throw new Error('Element has no bounding box')
  }

  const page = locator.page()
  const client = await page.context().newCDPSession(page)
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

test.describe('chat context menu selection state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chats/test?scenario=short&messages=2')
    await page.waitForSelector('[data-role="assistant"]')
    await page.waitForFunction(() => {
      return Boolean((window as typeof window & {
        __besidkaChatTest?: {
          selectMessage: (messageId: string) => void
        }
      }).__besidkaChatTest?.selectMessage)
    })
  })

  test('shows the context menu for a selected message', async ({ page }) => {
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

  test('reselecting the same message keeps the context menu open', async ({ page }) => {
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
