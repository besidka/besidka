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

  test('section titles carry icons and a search pick shows a price badge '
    + 'that toggles its note without moving the header', async ({ page }) => {
    await openNewChat(page)
    await page.locator(TOOLS_TRIGGER).click()

    const panel = page.locator(TOOLS_PANEL)
    const searchHeading = panel.locator('[data-section="search"] h3')

    await expect(panel).toBeVisible()

    for (const section of ['add', 'search', 'reasoning']) {
      await expect(panel.locator(
        `[data-section="${section}"] h3 [data-testid="tools-section-icon"]`,
      )).toBeVisible()
    }

    await expect(panel.locator('[data-testid="web-search-caption"]'))
      .toHaveCount(0)
    await expect(panel.locator('[data-testid="web-search-price-badge"]'))
      .toHaveCount(0)

    const headerHeightBefore = await searchHeading.evaluate((element) => {
      return element.parentElement?.offsetHeight
    })

    await panel.locator('[data-testid="web-search-option-web_search"]')
      .check()

    const badge = panel.locator('[data-testid="web-search-price-badge"]')
    const note = panel.locator('[data-testid="web-search-price-note"]')

    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('aria-expanded', 'false')
    await expect(note).toBeHidden()

    const headerHeightAfter = await searchHeading.evaluate((element) => {
      return element.parentElement?.offsetHeight
    })

    expect(headerHeightAfter).toBe(headerHeightBefore)

    await badge.click()

    await expect(badge).toHaveAttribute('aria-expanded', 'true')
    await expect(note).toBeVisible()
    await expect(note).toContainText('The model\'s own search')

    await panel.locator('[data-testid="web-search-option-off"]').check()

    await expect(badge).toHaveCount(0)
    await expect(note).toHaveCount(0)
  })

  test('a tile opens the menu at its section', async ({ page }) => {
    await openNewChat(page)

    await page.locator(TOOLS_TRIGGER).click()
    await page.locator('[data-testid="new-chat-memory-toggle"]').uncheck()
    await page.keyboard.press('Escape')

    await page.locator('[data-testid="chat-input-tile-memory-body"]').click()

    await expect(page.locator(TOOLS_PANEL)).toBeVisible()
    await expect(page.locator(TOOLS_PANEL)).toBeFocused()

    await page.keyboard.press('Escape')
    await page.locator('[data-testid="chat-input-tile-memory-body"]').focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-testid="new-chat-memory-toggle"]'))
      .toBeFocused()
  })

  test('the panel fits the space above "+" without clipping a row',
    async ({ page }) => {
      await openNewChat(page)
      await page.locator(TOOLS_TRIGGER).click()

      const scroll = page.locator('[data-testid="chat-input-tools-scroll"]')

      await expect(page.locator(TOOLS_PANEL)).toBeVisible()

      const fitsWithoutScroll = await scroll.evaluate((element) => {
        return element.scrollHeight <= element.clientHeight + 1
      })

      expect(fitsWithoutScroll).toBe(true)

      await page.waitForTimeout(400)

      const highLevel = page.locator('[data-testid="reasoning-level-high"]')

      await highLevel.check()

      await expect(
        page.locator('[data-testid="reasoning-save-default-button"]'),
      ).toBeEnabled()
      await expect(
        page.locator('[data-testid="reasoning-default-caption"]'),
      ).toContainText('Save High as default')

      const panelTop = await page.locator(TOOLS_PANEL).evaluate((element) => {
        return element.getBoundingClientRect().top
      })

      expect(panelTop).toBeGreaterThanOrEqual(0)
    })
})

test.describe('short desktop window', () => {
  test.use({ viewport: { width: 1280, height: 520 } })

  test('the panel stays on screen and fades the rows it cannot show',
    async ({ page }) => {
      await openNewChat(page)
      await page.locator(TOOLS_TRIGGER).click()

      const panel = page.locator(TOOLS_PANEL)
      const scroll = page.locator('[data-testid="chat-input-tools-scroll"]')

      await expect(panel).toBeVisible()

      const panelTop = await panel.evaluate((element) => {
        return element.getBoundingClientRect().top
      })

      expect(panelTop).toBeGreaterThanOrEqual(0)

      await expect.poll(async () => {
        return scroll.evaluate((element) => {
          return getComputedStyle(element).maskImage
        })
      }).toMatch(/rgba\(0, 0, 0, 0\) 100%\)$/)

      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })

      await expect.poll(async () => {
        return scroll.evaluate((element) => {
          return getComputedStyle(element).maskImage
        })
      }).toMatch(/^linear-gradient\(rgba\(0, 0, 0, 0\) 0px/)
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
        .toHaveCount(0)

      const bottomPadding = await sheet
        .locator('[data-testid="chat-input-tools-sheet-scroll"]')
        .evaluate((element) => {
          return Number.parseFloat(getComputedStyle(element).paddingBottom)
        })

      expect(bottomPadding).toBeGreaterThanOrEqual(16)

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
      ).not.toBeFocused()
      await expect(page.locator(`${TOOLS_PANEL} [data-section="search"]`))
        .toHaveClass(/bg-accent\/10/)
    })
})
