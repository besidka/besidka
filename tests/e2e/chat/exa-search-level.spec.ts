import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const EXA_LEVEL_STORAGE_KEY = 'settings_exa_search_level'
const WEB_SEARCH_DROPDOWN_SELECTOR
  = 'details:has([data-testid="web-search-trigger"])'

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 1,
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

async function openWebSearchDropdown(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="web-search-trigger"]')

  await expect(trigger).toBeVisible({ timeout: 15_000 })
  await trigger.hover()

  await expect(
    page.locator(WEB_SEARCH_DROPDOWN_SELECTOR),
  ).toHaveJSProperty('open', true)
}

test('shows the Exa search level picker, keeps the dropdown '
  + 'open on select and persists the chosen level', async ({ page }) => {
  await seedWebSearchTool(page, 'web_search_exa')

  await page.goto('/chats/new')
  await waitForHydration(page)

  await openWebSearchDropdown(page)

  const dropdown = page.locator(WEB_SEARCH_DROPDOWN_SELECTOR)
  const liteButton = dropdown.locator('[data-testid="exa-search-level-lite"]')
  const autoButton = dropdown.locator('[data-testid="exa-search-level-auto"]')
  const deepButton = dropdown.locator('[data-testid="exa-search-level-deep"]')

  await expect(liteButton).toBeVisible()
  await expect(autoButton).toBeVisible()
  await expect(deepButton).toBeVisible()

  await expect(autoButton).toHaveClass(/bg-accent/)
  await expect(liteButton).not.toHaveClass(/bg-accent/)
  await expect(deepButton).not.toHaveClass(/bg-accent/)

  await deepButton.click()

  await expect(deepButton).toHaveClass(/bg-accent/)
  await expect(autoButton).not.toHaveClass(/bg-accent/)

  await expect(
    page.locator(WEB_SEARCH_DROPDOWN_SELECTOR),
  ).toHaveJSProperty('open', true)
  await expect(liteButton).toBeVisible()

  const storedLevel = await page.evaluate((storageKey) => {
    return window.localStorage.getItem(storageKey)
  }, EXA_LEVEL_STORAGE_KEY)

  expect(storedLevel).toBe('deep')
})

test('does not render the Exa search level picker when another search '
  + 'provider is selected or search is off', async ({ page }) => {
  await seedWebSearchTool(page, 'web_search_brave')

  await page.goto('/chats/new')
  await waitForHydration(page)

  await openWebSearchDropdown(page)

  await expect(
    page.locator('[data-testid="exa-search-level-auto"]'),
  ).toHaveCount(0)

  await page
    .locator(`${WEB_SEARCH_DROPDOWN_SELECTOR} button`)
    .filter({ hasText: 'Off' })
    .click()

  await expect(
    page.locator('[data-testid="exa-search-level-auto"]'),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-testid="exa-search-level-deep"]'),
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

    await openWebSearchDropdown(page)
    await page
      .locator(WEB_SEARCH_DROPDOWN_SELECTOR)
      .locator('[data-testid="exa-search-level-deep"]')
      .click()

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
