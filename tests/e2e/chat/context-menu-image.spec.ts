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

// The context menu can visually overlap the image preview trigger on a
// small viewport, especially with few messages. A tap that lands on the
// menu itself (e.g. the Branch button) proves nothing about click-through
// to the image underneath, so this picks a corner of the trigger's own
// bounding box that falls outside the menu's, then verifies via
// elementFromPoint that the point genuinely resolves onto the trigger
// before dispatching the touch — failing loudly instead of silently
// testing the wrong thing if a future layout change reintroduces overlap.
async function quickTapOnImagePreviewTrigger(
  previewTrigger: Locator,
): Promise<void> {
  const page = previewTrigger.page()
  const box = await previewTrigger.boundingBox()

  if (!box) {
    throw new Error('Preview trigger has no bounding box')
  }

  const menuBox = await page.getByTestId('chat-messages-container')
    .getByRole('list')
    .boundingBox()

  const candidates = [
    { x: box.x + box.width - 4, y: box.y + box.height - 4 },
    { x: box.x + 4, y: box.y + 4 },
    { x: box.x + 4, y: box.y + box.height - 4 },
    { x: box.x + box.width - 4, y: box.y + 4 },
  ]

  const point = candidates.find((candidate) => {
    if (!menuBox) return true

    const insideMenu = candidate.x >= menuBox.x
      && candidate.x <= menuBox.x + menuBox.width
      && candidate.y >= menuBox.y
      && candidate.y <= menuBox.y + menuBox.height

    return !insideMenu
  })

  if (!point) {
    throw new Error(
      'The context menu fully covers the image preview trigger — cannot '
      + 'construct a tap point that avoids it',
    )
  }

  const isOnTrigger = await page.evaluate(([px, py]) => {
    const element = document.elementFromPoint(px, py)

    return !!element?.closest(
      '[data-testid="generated-image-preview-trigger"]',
    )
  }, [point.x, point.y] as const)

  if (!isOnTrigger) {
    throw new Error(
      `Tap point (${point.x}, ${point.y}) does not resolve onto the image `
      + 'preview trigger — test setup is unsound',
    )
  }

  const client = await page.context().newCDPSession(page)

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 1 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

interface ClippingCheckResult {
  hasClippingAncestor: boolean
  fitsWithinAncestor: boolean
}

const CLIPPING_CHECK_EPSILON = 0.5

async function getClippingViolation(
  locator: Locator,
): Promise<ClippingCheckResult> {
  return locator.evaluate((element, epsilon) => {
    const menu = element.closest('ul.menu')
    let ancestor = (menu?.parentElement ?? element.parentElement) as
      HTMLElement | null
    const targetRect = element.getBoundingClientRect()

    while (ancestor) {
      const style = window.getComputedStyle(ancestor)
      const clipsVertically = style.overflowY === 'hidden'
        || style.overflowY === 'auto'
        || style.overflowY === 'scroll'

      if (clipsVertically) {
        const ancestorRect = ancestor.getBoundingClientRect()

        return {
          hasClippingAncestor: true,
          fitsWithinAncestor:
            targetRect.bottom <= ancestorRect.bottom + epsilon
            && targetRect.top >= ancestorRect.top - epsilon,
        }
      }

      ancestor = ancestor.parentElement
    }

    return { hasClippingAncestor: false, fitsWithinAncestor: true }
  }, CLIPPING_CHECK_EPSILON)
}

test.describe('chat context menu for AI-generated-image messages', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(30_000)

    await page.goto('/chats/test?scenario=image&messages=2')
    await page.waitForSelector('[data-role="assistant"]')
    await page.waitForFunction(() => {
      return Boolean((window as typeof window & {
        __besidkaChatTest?: {
          selectMessage: (messageId: string) => void
        }
      }).__besidkaChatTest?.selectMessage)
    })
  })

  test('shows the full metadata card without clipping the last row', async ({
    page,
  }) => {
    const assistantMessage = page.locator('[data-role="assistant"]').first()

    await expect(assistantMessage).toBeVisible()

    await longPress(assistantMessage)

    await expect(page.getByTestId('message-menu-model')).toBeVisible()
    await expect(page.getByTestId('message-menu-tools')).toBeVisible()
    await expect(page.getByTestId('message-menu-tokens')).toBeVisible()
    await expect(
      page.getByTestId('message-menu-cost-current'),
    ).toBeVisible()
    await expect(
      page.getByTestId('message-menu-cost-to-message'),
    ).toBeVisible()
    await expect(
      page.getByTestId('message-menu-cost-chat-total'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    const lastMenuItem = page.getByTestId('message-menu-copy-markdown')

    await expect(lastMenuItem).toBeVisible()

    const clipping = await getClippingViolation(lastMenuItem)

    expect(clipping.fitsWithinAncestor).toBe(true)
  })

  test('tapping a blurred generated image under a different selected message dismisses the menu without opening the preview', async ({
    page,
  }) => {
    const userMessage = page.locator('[data-role="user"]').first()
    const previewTrigger = page.getByTestId(
      'generated-image-preview-trigger',
    )

    await expect(userMessage).toBeVisible()
    await expect(previewTrigger).toBeVisible()

    await longPress(userMessage)

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await quickTapOnImagePreviewTrigger(previewTrigger)

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeHidden()

    // The preview is a lazy-loaded async component that can take a couple
    // of seconds to compile in dev mode on first use. Asserting "hidden"
    // immediately would trivially pass before it ever had a chance to
    // render, whether or not the click actually got through — wait out
    // that window first so this proves it never opens, not that it merely
    // hasn't opened yet.
    await page.waitForTimeout(3000)

    await expect(page.getByTestId('image-preview-modal')).toBeHidden()
  })

  test('tapping the selected message\'s own generated image dismisses the menu without opening the preview', async ({
    page,
  }) => {
    const assistantMessage = page.locator('[data-role="assistant"]').first()
    const previewTrigger = page.getByTestId(
      'generated-image-preview-trigger',
    )

    await expect(assistantMessage).toBeVisible()
    await expect(previewTrigger).toBeVisible()

    await longPress(assistantMessage)

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await quickTapOnImagePreviewTrigger(previewTrigger)

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeHidden()

    // The preview is a lazy-loaded async component that can take a couple
    // of seconds to compile in dev mode on first use. Asserting "hidden"
    // immediately would trivially pass before it ever had a chance to
    // render, whether or not the click actually got through — wait out
    // that window first so this proves it never opens, not that it merely
    // hasn't opened yet.
    await page.waitForTimeout(3000)

    await expect(page.getByTestId('image-preview-modal')).toBeHidden()
  })
})
