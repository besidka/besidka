import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const TOOLS_TRIGGER = '[data-testid="chat-input-tools-trigger"]'
const TOOLS_PANEL = '[data-testid="chat-input-tools-panel"]'
const SEARCH_TILE = '[data-testid="chat-input-tile-search"]'

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

  await page.addInitScript(() => {
    window.localStorage.setItem('settings_web_search_tool', 'off')
  })
})

async function openNewChat(page: Page) {
  await page.goto('/chats/new')
  await waitForHydration(page)
  await expect(page.locator(TOOLS_TRIGGER)).toBeVisible({ timeout: 15_000 })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a clean new chat shows no tiles, and a search pick adds a removable '
    + 'tile', async ({ page }) => {
    await openNewChat(page)

    await expect(page.locator('[data-testid^="chat-input-tile-"]'))
      .toHaveCount(0)

    await page.locator(TOOLS_TRIGGER).click()

    const panel = page.locator(TOOLS_PANEL)

    await expect(panel).toBeVisible()
    await panel.locator('[data-testid="web-search-option-web_search"]')
      .check()

    await expect(panel).toBeVisible()
    await expect(page.locator(SEARCH_TILE)).toContainText('Built-in')

    await page.keyboard.press('Escape')

    await expect(panel).toBeHidden()
    await expect(page.locator(TOOLS_TRIGGER)).toBeFocused()

    await page.locator('[data-testid="chat-input-tile-search-remove"]')
      .click()

    await expect(page.locator(SEARCH_TILE)).toHaveCount(0)
  })

  test('a tile opens the menu at its section', async ({ page }) => {
    await openNewChat(page)

    await page.locator(TOOLS_TRIGGER).click()
    await page.locator('[data-testid="new-chat-memory-toggle"]').uncheck()
    await page.keyboard.press('Escape')

    await page.locator('[data-testid="chat-input-tile-memory-body"]').click()

    await expect(page.locator(TOOLS_PANEL)).toBeVisible()
    await expect(page.locator('[data-testid="new-chat-memory-toggle"]'))
      .toBeFocused()
  })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('"+" opens a bottom sheet and the toolbar never overflows',
    async ({ page }) => {
      await openNewChat(page)

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth
          > document.documentElement.clientWidth
      })

      expect(hasHorizontalOverflow).toBe(false)

      await page.locator(TOOLS_TRIGGER).click()

      const sheet = page.locator(`dialog[open].modal-bottom${TOOLS_PANEL}`)

      await expect(sheet).toBeVisible()
      await expect(sheet.locator('[data-testid="chat-input-tools-chips"]'))
        .toContainText('Nothing changed from the defaults')

      await sheet.locator('[data-testid="web-search-option-web_search"]')
        .check()

      await expect(sheet.locator('[data-testid="chat-input-tools-chip-search"]'))
        .toContainText('Search: Built-in')

      await page.keyboard.press('Escape')

      await expect(sheet).toBeHidden()
      await expect(page.locator(SEARCH_TILE)).toBeVisible()

      await page.locator('[data-testid="chat-input-tile-search-body"]')
        .click()

      await expect(page.locator(`dialog[open]${TOOLS_PANEL}`)).toBeVisible()
      await expect(
        page.locator('[data-testid="web-search-option-web_search"]'),
      ).toBeFocused()
    })
})
