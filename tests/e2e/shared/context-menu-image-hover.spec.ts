import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function selectMessage(page: Page, locator: Locator): Promise<void> {
  const messageId = await locator.getAttribute('data-message-id')

  if (!messageId) {
    throw new Error('Message is missing data-message-id')
  }

  await page.evaluate((id) => {
    ;(window as typeof window & {
      __besidkaChatTest?: {
        selectMessage: (messageId: string) => void
      }
    }).__besidkaChatTest?.selectMessage(id)
  }, messageId)
}

async function getCtaOpacity(page: Page): Promise<string> {
  const openButton = page.getByTestId('chat-file-open')

  return openButton.evaluate((el) => {
    return getComputedStyle(el.parentElement || el).opacity
  })
}

test.describe('shared chat image hover affordances', () => {
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

  test('reveals the preview/download CTAs on a normal hover when nothing is selected', async ({
    page,
  }) => {
    const previewTrigger = page.getByTestId('chat-file-preview-trigger')

    await previewTrigger.hover()

    await expect.poll(() => getCtaOpacity(page)).toBe('1')
  })

  test('does not reveal CTAs while hovering a blurred, non-selected message\'s image', async ({
    page,
  }) => {
    const userMessage = page.locator('[data-role="user"]').first()
    const previewTrigger = page.getByTestId('chat-file-preview-trigger')

    await selectMessage(page, userMessage)
    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await previewTrigger.hover({ force: true })

    await expect.poll(() => getCtaOpacity(page)).toBe('0')
    expect(
      await previewTrigger.evaluate((el) => {
        return getComputedStyle(el.parentElement || el).pointerEvents
      }),
    ).toBe('none')
  })

  test('does not reveal CTAs when hovering the wide reserved space beside the image tile', async ({
    page,
  }) => {
    const previewTrigger = page.getByTestId('chat-file-preview-trigger')
    const box = await previewTrigger.boundingBox()

    if (!box) {
      throw new Error('Preview trigger has no bounding box')
    }

    // Well outside the (fit-content) image tile but still inside the
    // message row's much wider reserved width (sm:w-4xl) — this used to
    // incorrectly satisfy Tailwind's unscoped group-hover, which matches
    // ANY ancestor with class "group", including Message.vue's outer
    // wrapper, not just this tile's own group.
    await page.mouse.move(box.x + box.width + 300, box.y + box.height / 2)

    await expect.poll(() => getCtaOpacity(page)).toBe('0')
  })

  test('shows a themed accent focus ring instead of the browser default outline', async ({
    page,
  }) => {
    const previewTrigger = page.getByTestId('chat-file-preview-trigger')

    await previewTrigger.focus()

    const style = await previewTrigger.evaluate((el) => {
      const computed = getComputedStyle(el)

      return {
        outlineStyle: computed.outlineStyle,
        boxShadow: computed.boxShadow,
      }
    })

    expect(style.outlineStyle).toBe('none')
    expect(style.boxShadow).not.toContain('none')
    expect(style.boxShadow.toLowerCase()).not.toContain('blue')
  })
})
