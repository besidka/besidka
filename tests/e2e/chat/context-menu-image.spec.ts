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
})
