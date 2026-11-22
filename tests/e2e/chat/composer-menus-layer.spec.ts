import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const SCROLL_BUTTON = '[data-testid="scroll-to-bottom"]'
const CHAT_INPUT_TEXTAREA = '[data-testid="chat-input-textarea"]'
const TOOLS_TRIGGER = '[data-testid="chat-input-tools-trigger"]'
const TOOLS_PANEL = '[data-testid="chat-input-tools-panel"]'
const MODEL_TRIGGER = '[data-testid="current-model-trigger"]'
const MODEL_PANEL = '[data-testid="models-picker-panel"]'

test.describe.configure({ timeout: 45_000 })

test.use({ viewport: { width: 1280, height: 800 } })

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

async function openNewChatWithScrollButton(page: Page): Promise<void> {
  await page.goto('/chats/new')
  await waitForHydration(page)
  await expect(page.locator(TOOLS_TRIGGER)).toBeVisible({ timeout: 15_000 })

  await page.addStyleTag({
    content: `#nuxt-devtools-anchor { display: none !important; }
      [data-testid="chat-input"] > div:has(${SCROLL_BUTTON}) {
        display: block !important;
      }`,
  })

  await expect(page.locator(SCROLL_BUTTON)).toBeVisible()
  await expect(page.locator(CHAT_INPUT_TEXTAREA)).toBeInViewport()
}

async function getTopElementInfoAtScrollButton(
  page: Page,
  containerSelector: string,
): Promise<{ isScrollButton: boolean, isInsideContainer: boolean }> {
  return page.evaluate(({ buttonSelector, panelSelector }) => {
    const button = document.querySelector<HTMLElement>(buttonSelector)
    const panel = document.querySelector<HTMLElement>(panelSelector)

    if (!button || !panel) {
      throw new Error('Scroll button or panel is missing')
    }

    const rect = button.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const topElement = document.elementFromPoint(centerX, centerY)

    return {
      isScrollButton: !!topElement && button.contains(topElement),
      isInsideContainer: !!topElement && panel.contains(topElement),
    }
  }, { buttonSelector: SCROLL_BUTTON, panelSelector: containerSelector })
}

test('the scroll button is clickable when no composer menu is open',
  async ({ page }) => {
    await openNewChatWithScrollButton(page)

    const info = await page.evaluate((selector) => {
      const button = document.querySelector<HTMLElement>(selector)!
      const rect = button.getBoundingClientRect()
      const topElement = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )

      return !!topElement && button.contains(topElement)
    }, SCROLL_BUTTON)

    expect(info).toBe(true)
  },
)

test('the tools menu opens above the scroll button', async ({ page }) => {
  await openNewChatWithScrollButton(page)
  await page.locator(TOOLS_TRIGGER).click()
  await expect(page.locator(TOOLS_PANEL)).toBeVisible()

  const info = await getTopElementInfoAtScrollButton(page, TOOLS_PANEL)

  expect(info.isInsideContainer).toBe(true)
  expect(info.isScrollButton).toBe(false)
})

test('the model picker opens above the scroll button', async ({ page }) => {
  await openNewChatWithScrollButton(page)
  await page.locator(MODEL_TRIGGER).click()
  await expect(page.locator(MODEL_PANEL)).toBeVisible()

  const info = await getTopElementInfoAtScrollButton(page, MODEL_PANEL)

  expect(info.isInsideContainer).toBe(true)
  expect(info.isScrollButton).toBe(false)
})
