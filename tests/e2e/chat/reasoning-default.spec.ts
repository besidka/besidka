import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const TOOLS_TRIGGER = '[data-testid="chat-input-tools-trigger"]'
const TOOLS_PANEL = '[data-testid="chat-input-tools-panel"]'
const REASONING_TILE = '[data-testid="chat-input-tile-reasoning"]'
const NEW_CHAT_URL = '/chats/new'
const FIRST_MESSAGE = 'Which level am I sent with?'

type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

test.describe.configure({ timeout: 45_000 })

test.beforeEach(async ({ context, page }) => {
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

test.afterEach(async ({ page }) => {
  await saveDefaultReasoningLevel(page, null)
})

async function saveDefaultReasoningLevel(
  page: Page,
  level: ReasoningLevel | null,
) {
  const response = await page.request.patch('/api/v1/profiles/settings', {
    data: { defaultReasoningLevel: level },
  })

  expect(response.ok()).toBe(true)
}

async function openNewChatByFullLoad(page: Page) {
  const settingsResponse = page.waitForResponse((response) => {
    return response.url().includes('/api/v1/profiles/settings')
      && response.request().method() === 'GET'
  })

  await page.goto(NEW_CHAT_URL)
  await waitForHydration(page)
  await settingsResponse
  await expect(page.locator(TOOLS_TRIGGER)).toBeVisible({ timeout: 15_000 })
}

test('a full load of a new chat follows the saved default reasoning level '
  + 'and sends with it', async ({ page }) => {
  await saveDefaultReasoningLevel(page, 'high')

  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await route.fulfill({
      json: { keys: [{ provider: 'google', hasKey: true }] },
    })
  })

  const sentReasoningLevels: unknown[] = []

  await page.route('**/api/v1/chats/new', async (route) => {
    sentReasoningLevels.push(route.request().postDataJSON()?.reasoning)

    await route.fulfill({
      status: 503,
      json: { message: 'Not sent in this test' },
    })
  })

  await openNewChatByFullLoad(page)

  await page.locator(TOOLS_TRIGGER).click()
  await expect(page.locator(TOOLS_PANEL)).toBeVisible()
  await expect(page.locator('[data-testid="reasoning-level-high"]'))
    .toBeChecked()
  await expect(page.locator('[data-testid="reasoning-default-caption"]'))
    .toContainText('High is your default')

  await page.keyboard.press('Escape')
  await expect(page.locator(TOOLS_PANEL)).toBeHidden()
  await expect(page.locator(REASONING_TILE)).toHaveCount(0)

  await page.locator('textarea').fill(FIRST_MESSAGE)
  await page.getByRole('button', { name: 'Send Message' }).click()

  await expect.poll(() => {
    return sentReasoningLevels
  }).toEqual(['high'])
})
