import { expect, test } from '@playwright/test'

test.describe('chat context menu for AI-generated-image messages (desktop mouse)', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(30_000)

    await page.goto('/chats/test?scenario=image&messages=2')
    await page.waitForSelector('[data-role="assistant"]')
  })

  test('right-clicking a message then left-clicking a different message\'s image dismisses the menu without opening the preview', async ({
    page,
  }) => {
    const userMessage = page.locator('[data-role="user"]').first()
    const previewTrigger = page.getByTestId('generated-image-preview-trigger')

    await expect(userMessage).toBeVisible()
    await expect(previewTrigger).toBeVisible()

    await userMessage.click({ button: 'right' })

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await previewTrigger.click()

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

  test('right-clicking the assistant message with its own image dismisses the menu without opening the preview', async ({
    page,
  }) => {
    const assistantMessage = page.locator('[data-role="assistant"]').first()
    const previewTrigger = page.getByTestId('generated-image-preview-trigger')
    // Right-clicking directly on the <img>/preview trigger is intentionally
    // exempt from opening the context menu (preserves the browser's native
    // image context menu), so target the filename caption below the image
    // instead — same message bubble, not an image/link element.
    const filenameCaption = page.getByTestId('generated-image-ready')
      .locator('p').first()

    await expect(assistantMessage).toBeVisible()
    await expect(previewTrigger).toBeVisible()

    await filenameCaption.click({ button: 'right' })

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeVisible()

    await previewTrigger.click()

    await expect(
      page.getByRole('button', { name: 'Branch chat from here' }),
    ).toBeHidden()

    await page.waitForTimeout(3000)

    await expect(page.getByTestId('image-preview-modal')).toBeHidden()
  })
})
