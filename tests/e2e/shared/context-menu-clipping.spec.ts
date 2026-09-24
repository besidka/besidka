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

const METADATA_ROW_TEST_IDS = [
  'message-menu-model',
  'message-menu-provider',
  'message-menu-tools',
  'message-menu-search-grounding',
] as const

interface MetadataRowMeasurement {
  testId: string
  right: number
  scrollWidth: number
  clientWidth: number
}

interface MetadataOverflowResult {
  menuRight: number
  infoScrollWidth: number
  infoClientWidth: number
  rows: MetadataRowMeasurement[]
}

async function getMetadataOverflow(
  page: Page,
): Promise<MetadataOverflowResult> {
  return page.evaluate((rowTestIds) => {
    const menu = document.querySelector('ul.menu')
    const info = document.querySelector(
      '[data-testid="message-menu-info"]',
    )

    if (!menu || !info) {
      throw new Error('Context menu metadata is not open')
    }

    const rows = rowTestIds.map((testId) => {
      const row = document.querySelector(`[data-testid="${testId}"]`)
      const value = row?.querySelector('.truncate')

      if (!row || !value) {
        throw new Error(`Missing metadata row or value for ${testId}`)
      }

      return {
        testId,
        right: value.getBoundingClientRect().right,
        scrollWidth: value.scrollWidth,
        clientWidth: value.clientWidth,
      }
    })

    return {
      menuRight: menu.getBoundingClientRect().right,
      infoScrollWidth: info.scrollWidth,
      infoClientWidth: info.clientWidth,
      rows,
    }
  }, [...METADATA_ROW_TEST_IDS])
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
    // Selected by id rather than `.last()`: the long-metadata regression
    // fixture below is appended after this message, so it — not this one —
    // is now the last assistant message in the DOM.
    const imageMessage = page.locator(
      '[data-message-id="shared-test-image-assistant"]',
    )

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
  // endpoint's filterPublicParts() strips tool parts). Since
  // isAssistantGeneratedImageFilePart() now claims any such part (see
  // app/utils/generated-images.ts), a *visible* generated image renders
  // through ChatGeneratedImage.vue's fixed w-80 (320px) card, which can
  // never be narrower than the menu. The one remaining narrow, image-only
  // bubble is a `showFiles: false` share's hidden-file placeholder — it
  // short-circuits to ChatFiles.vue's 192px tile before
  // isAssistantGeneratedImageFilePart() ever runs (see
  // buildTestHiddenFilePart() in server/utils/chats/test/image-fixture.ts)
  // — so that is what this test selects to keep covering
  // shouldFitMessageBubble() shrinking `.js-chat-bubble` to fit-content
  // below the menu's own 256px (w-64) width, the scenario the menu's
  // unclamped `right` fallback did not defend against.
  test('does not push the menu off-screen for a narrower-than-menu bubble', async ({
    page,
  }) => {
    const imageMessage = page.locator(
      '[data-message-id="shared-test-hidden-file-assistant"]',
    )

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

  // Regression coverage for a real-world overflow: a long Cloudflare model
  // id, a gateway provider label, a Brave-attributed tool, and a web-search
  // cost row together push each row's natural (max-content) width well past
  // the menu's 256px (w-64). Without an explicit width constraint winning
  // over daisyUI's `.menu { width: fit-content }`, the whole metadata block
  // grows to fit its widest row instead of staying pinned to the menu's own
  // width, so every value renders at full size and gets hard-clipped by the
  // menu's own overflow-x-hidden with no ellipsis — not gracefully truncated
  // by the per-row `truncate` classes, which never get a chance to shrink.
  test('constrains every metadata row to the menu width, truncating '
    + 'the long model id with an ellipsis', async ({ page }) => {
    const message = page.locator(
      '[data-message-id="shared-test-long-metadata-assistant"]',
    )

    await expect(message).toBeVisible()

    await selectMessage(message)

    await expect(page.getByTestId('message-menu-model')).toBeVisible()
    await expect(page.getByTestId('message-menu-provider')).toBeVisible()
    await expect(page.getByTestId('message-menu-tools')).toBeVisible()
    await expect(
      page.getByTestId('message-menu-search-grounding'),
    ).toBeVisible()

    const overflow = await getMetadataOverflow(page)

    expect(overflow.infoScrollWidth).toBeLessThanOrEqual(
      overflow.infoClientWidth + CLIPPING_CHECK_EPSILON,
    )

    for (const row of overflow.rows) {
      expect(row.right).toBeLessThanOrEqual(
        overflow.menuRight + CLIPPING_CHECK_EPSILON,
      )
    }

    const modelRow = overflow.rows.find((row) => {
      return row.testId === 'message-menu-model'
    })

    expect(modelRow).toBeDefined()
    expect(modelRow?.scrollWidth).toBeGreaterThan(modelRow?.clientWidth ?? 0)
  })
})
