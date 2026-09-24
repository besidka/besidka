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

// isAssistantGeneratedImageFilePart() (app/utils/generated-images.ts) now
// claims every image `file` part on an assistant message, so the fixture's
// generated image renders through ChatGeneratedImage.vue, not ChatFiles.vue
// — its `generated-image-*` testids are the ones this spec targets. Two
// tests that used to live here covered ChatFiles.vue's hover-reveal CTA row
// (`md:opacity-0 md:group-hover/file:opacity-100`) and the Tailwind
// unscoped `.group` regression it guards against: ChatGeneratedImage.vue's
// action row (open/attach/download) is always visible by design, so a
// hover-reveal assertion against it would be trivially true and prove
// nothing. That coverage only still applies to ChatFiles.vue's carousel for
// a genuine user-uploaded attachment, which this fixture does not exercise
// and no other e2e spec currently covers — a real, if pre-existing, gap.
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

  test('does not reveal the preview trigger while hovering a blurred, non-selected message\'s image', async ({
    page,
  }) => {
    const userMessage = page.locator('[data-role="user"]').first()
    const previewTrigger = page.getByTestId('generated-image-preview-trigger')

    await selectMessage(page, userMessage)
    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await previewTrigger.hover({ force: true })

    expect(
      await previewTrigger.evaluate((el) => {
        return getComputedStyle(el).pointerEvents
      }),
    ).toBe('none')
  })

  test('shows a themed accent focus ring instead of the browser default outline', async ({
    page,
  }) => {
    const previewTrigger = page.getByTestId('generated-image-preview-trigger')

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
