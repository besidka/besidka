import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const EXA_LEVEL_STORAGE_KEY = 'settings_exa_search_level'
const TOOLS_PANEL_SELECTOR = '[data-testid="chat-input-tools-panel"]'

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

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

  await page.route(
    '**/api/v1/profiles/keys**',
    async (route) => {
      await route.fulfill({
        json: {
          keys: [
            { provider: 'exa', hasKey: true },
            { provider: 'brave', hasKey: true },
          ],
        },
      })
    },
  )
})

async function seedWebSearchTool(
  page: Page,
  webSearchTool: string,
): Promise<void> {
  await page.addInitScript(
    ({ tool }) => {
      window.localStorage.setItem('settings_web_search_tool', tool)
    },
    { tool: webSearchTool },
  )
}

async function openToolsPanel(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="chat-input-tools-trigger"]')

  await expect(trigger).toBeVisible({ timeout: 15_000 })
  await trigger.click()

  await expect(page.locator(TOOLS_PANEL_SELECTOR)).toBeVisible()
}

test('shows the Exa search level picker, keeps the panel '
  + 'open on select and persists the chosen level', async ({ page }) => {
  await seedWebSearchTool(page, 'web_search_exa')

  await page.goto('/chats/new')
  await waitForHydration(page)

  await expect(
    page.locator('[data-testid="chat-input-tile-search"]'),
  ).toContainText('Exa · Auto', { timeout: 15_000 })

  await openToolsPanel(page)

  const panel = page.locator(TOOLS_PANEL_SELECTOR)
  const liteButton = panel.locator('[data-testid="exa-search-level-lite"]')
  const autoButton = panel.locator('[data-testid="exa-search-level-auto"]')
  const deepButton = panel.locator('[data-testid="exa-search-level-deep"]')

  await expect(liteButton).toBeEnabled()
  await expect(autoButton).toBeEnabled()
  await expect(deepButton).toBeEnabled()

  await expect(autoButton).toBeChecked()
  await expect(liteButton).not.toBeChecked()
  await expect(deepButton).not.toBeChecked()

  await deepButton.click()

  await expect(deepButton).toBeChecked()
  await expect(autoButton).not.toBeChecked()

  await expect(panel).toBeVisible()
  await expect(liteButton).toBeEnabled()
  await expect(
    page.locator('[data-testid="chat-input-tile-search"]'),
  ).toContainText('Exa · Deep')

  const storedLevel = await page.evaluate((storageKey) => {
    return window.localStorage.getItem(storageKey)
  }, EXA_LEVEL_STORAGE_KEY)

  expect(storedLevel).toBe('deep')
})

test('hides the Exa search level picker when another search provider is '
  + 'selected or search is off',
async ({ page }) => {
  await seedWebSearchTool(page, 'web_search_brave')

  await page.goto('/chats/new')
  await waitForHydration(page)

  await openToolsPanel(page)

  const panel = page.locator(TOOLS_PANEL_SELECTOR)

  await expect(
    panel.locator('[data-testid="exa-search-level-auto"]'),
  ).toHaveCount(0)

  await panel.locator('[data-testid="web-search-option-off"]').click()

  await expect(
    panel.locator('[data-testid="exa-search-level-auto"]'),
  ).toHaveCount(0)
  await expect(
    panel.locator('[data-testid="exa-search-level-deep"]'),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-testid="chat-input-tile-search"]'),
  ).toHaveCount(0)
})

test('sends the chosen Exa search level with the chat request',
  async ({ page }) => {
    const chatSlug = 'e2e-exa-search-level'

    await seedWebSearchTool(page, 'web_search_exa')

    await page.route('**/api/v1/chats/new', async (route) => {
      await route.fulfill({ json: { slug: chatSlug } })
    })

    await page.route(`**/api/v1/chats/${chatSlug}/title`, async (route) => {
      await route.fulfill({ json: { title: 'Exa search level' } })
    })

    await page.route(`**/api/v1/chats/${chatSlug}`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            id: 1,
            slug: chatSlug,
            title: '',
            projectId: null,
            branchedFromShareSlug: null,
            activeResearchJob: null,
            messages: [
              {
                id: 'e2e-exa-user-message',
                publicId: 'e2e-exa-user-message',
                role: 'user',
                parts: [{ type: 'text', text: 'latest exa news' }],
                tools: ['web_search_exa'],
                reasoning: 'off',
                createdAt: new Date().toISOString(),
                usage: null,
              },
            ],
          },
        })

        return
      }

      await route.abort()
    })

    await page.goto('/chats/new')
    await waitForHydration(page)

    await openToolsPanel(page)
    await page
      .locator(TOOLS_PANEL_SELECTOR)
      .locator('[data-testid="exa-search-level-deep"]')
      .click()
    await page.keyboard.press('Escape')

    const chatRequestPromise = page.waitForRequest((request) => {
      return request.method() === 'POST'
        && request.url().endsWith(`/api/v1/chats/${chatSlug}`)
    }, { timeout: 30_000 })

    await page.locator('textarea').fill('latest exa news')
    await page.getByRole('button', { name: 'Send Message' }).click()
    await page.waitForURL(`**/chats/${chatSlug}`)

    const chatRequest = await chatRequestPromise

    expect(chatRequest.postDataJSON()).toMatchObject({
      exaSearchLevel: 'deep',
    })
  })
