import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const MODEL_TRIGGER = '[data-testid="current-model-trigger"]'
const MODEL_PANEL = '[data-testid="models-picker-panel"]'
const MODEL_SHEET = `dialog[open].modal-bottom${MODEL_PANEL}`

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

  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await route.fulfill({
      json: {
        keys: [
          { provider: 'google', hasKey: true },
          { provider: 'openai', hasKey: true },
        ],
      },
    })
  })
})

async function openNewChat(page: Page) {
  await page.goto('/chats/new')
  await waitForHydration(page)
  await expect(page.locator(MODEL_TRIGGER)).toBeVisible({ timeout: 15_000 })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps the dropdown above the trigger', async ({ page }) => {
    await openNewChat(page)
    await page.locator(MODEL_TRIGGER).click()

    const panel = page.locator(MODEL_PANEL)

    await expect(panel).toBeVisible()
    await expect(panel).toHaveJSProperty('tagName', 'DIV')
    await expect(page.locator('[data-testid="models-picker-search"]'))
      .toBeFocused()
  })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('opens a bottom sheet that only an explicit action closes',
    async ({ page }) => {
      await openNewChat(page)
      await page.locator(MODEL_TRIGGER).click()

      const sheet = page.locator(MODEL_SHEET)
      const search = sheet.locator('[data-testid="models-picker-search"]')

      await expect(sheet).toBeVisible()
      await expect(search).not.toBeFocused()
      await expect(sheet.locator('[data-testid="models-picker-rail"]'))
        .toBeVisible()

      const sheetBox = await sheet
        .locator('[data-testid="models-picker-sheet-box"]')
        .boundingBox()

      expect(sheetBox?.width).toBe(375)

      await sheet.locator('[data-testid="models-picker-filter-trigger"]')
        .click()
      await sheet.locator('[data-testid="models-picker-filter-chat"]').click()
      await sheet.locator('[data-testid="models-picker-filter-trigger"]')
        .click()

      await expect(sheet).toBeVisible()
      await expect(sheet.locator('[data-testid="models-picker-filter-section"]'))
        .toHaveCount(0)

      await search.click()
      await search.fill('gemini')

      await expect(sheet).toBeVisible()
      await expect(sheet.locator('[data-testid="models-picker-rail"]'))
        .toHaveCount(0)

      const gatewayRail = sheet.locator(
        '[data-testid="models-picker-gateway-rail"]',
      )

      await expect(gatewayRail).toBeInViewport({ ratio: 1 })

      await page.keyboard.press('Escape')

      await expect(sheet).toBeVisible()
      await expect(search).toHaveValue('')

      await sheet.locator('[data-testid="models-picker-close"]').click()

      await expect(page.locator(MODEL_SHEET)).toHaveCount(0)
      await expect(page.locator(MODEL_TRIGGER)).toBeFocused()
    })

  test('closes on a model pick and returns focus to the trigger',
    async ({ page }) => {
      await openNewChat(page)
      await page.locator(MODEL_TRIGGER).click()

      const sheet = page.locator(MODEL_SHEET)
      const choice = sheet
        .locator('[data-testid="models-picker-results"] button[aria-label^="Choose "]')
        .last()
      const label = await choice.getAttribute('aria-label')
      const modelName = label?.replace(/^Choose /, '') ?? ''

      await choice.scrollIntoViewIfNeeded()
      await choice.click()

      await expect(page.locator(MODEL_SHEET)).toHaveCount(0)
      await expect(page.locator(MODEL_TRIGGER)).toBeFocused()
      await expect(page.locator(MODEL_TRIGGER)).toContainText(modelName)
    })

  test('closes from the backdrop', async ({ page }) => {
    await openNewChat(page)
    await page.locator(MODEL_TRIGGER).click()

    await expect(page.locator(MODEL_SHEET)).toBeVisible()

    await page.mouse.click(187, 20)

    await expect(page.locator(MODEL_SHEET)).toHaveCount(0)
  })
})
