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

async function selectMessage(locator: Locator): Promise<void> {
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

interface ViewportOverflowResult {
  left: number
  right: number
  fitsWithinViewport: boolean
}

async function getMenuViewportOverflow(
  page: Page,
): Promise<ViewportOverflowResult> {
  return page.evaluate(() => {
    const menu = document.querySelector('ul.menu') as HTMLElement | null

    if (!menu) {
      throw new Error('Context menu is not open')
    }

    const rect = menu.getBoundingClientRect()

    return {
      left: rect.left,
      right: rect.right,
      fitsWithinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
    }
  })
}

test.describe('shared chat context menu layout', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(30_000)

    await page.goto('/shared/test')
    await page.waitForSelector('[data-role="assistant"]')
    await page.waitForFunction(() => {
      return Boolean((window as typeof window & {
        __besidkaChatTest?: {
          selectMessage: (messageId: string) => void
        }
      }).__besidkaChatTest?.selectMessage)
    })
  })

  test('does not clip the metadata card for the last image message', async ({
    page,
  }) => {
    const imageMessage = page.locator('[data-role="assistant"]').last()

    await expect(imageMessage).toBeVisible()

    await selectMessage(imageMessage)

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

    // The fixture message is image-only (no text part), so ContextMenu's
    // copyText is empty and it skips the copy section entirely — "Branch
    // chat from here" is the real last item for this message shape.
    const lastMenuItem = page.getByRole('button', {
      name: 'Branch chat from here',
    })

    await expect(lastMenuItem).toBeVisible()

    const clipping = await getClippingViolation(lastMenuItem)

    expect(clipping.fitsWithinAncestor).toBe(true)
  })

  // A real generated-image message only ever reaches the shared page as a
  // bare `file` part (server/utils/files/assistant-files.ts converts the
  // tool-generate_image part to `file` at persistence, and the shared
  // endpoint's filterPublicParts() strips tool parts) so it renders through
  // ChatFiles.vue's 192px thumbnail, not ChatGeneratedImage.vue's 320px
  // card. That narrow, image-only bubble is exactly what makes
  // shouldFitMessageBubble() shrink `.js-chat-bubble` to fit-content, which
  // can land it below the menu's own 256px (w-64) width — the scenario the
  // menu's unclamped `right` fallback did not defend against.
  test('does not push the menu off-screen for a narrower-than-menu bubble', async ({
    page,
  }) => {
    const imageMessage = page.locator('[data-role="assistant"]').last()

    await expect(imageMessage).toBeVisible()

    const bubbleWidth = await imageMessage.evaluate((element) => {
      const bubble = element.querySelector('.js-chat-bubble')

      if (!bubble) {
        throw new Error('Message is missing .js-chat-bubble')
      }

      return bubble.getBoundingClientRect().width
    })

    expect(bubbleWidth).toBeLessThan(256)

    await selectMessage(imageMessage)

    const menu = page.locator('ul.menu')

    await expect(menu).toBeVisible()

    const overflow = await getMenuViewportOverflow(page)

    expect(overflow.fitsWithinViewport).toBe(true)
  })
})
