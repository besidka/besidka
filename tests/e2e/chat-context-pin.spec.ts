import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/auth'

const SIDEBAR = '[data-testid="sidebar"]'
const CONTEXT_TRIGGER = '[data-testid="sidebar-chat-context"]'
const SIDE_PANEL = '[data-testid="side-panel"]'
const CONTEXT_PANEL = '[data-testid="chat-context-panel"]'
const PIN_BUTTON = '[data-testid="chat-context-pin"]'
const PINNED_LIST = '[data-testid="history-pinned-list"]'

test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ context }) => {
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
})

async function seedChat(page: Page, title: string): Promise<string> {
  const createResponse = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: title }],
      tools: [],
    },
  })

  expect(createResponse.ok()).toBe(true)

  const { slug } = await createResponse.json()
  const renameResponse = await page.request.patch(
    `/api/v1/chats/${slug}/rename`,
    { data: { title } },
  )

  expect(renameResponse.ok()).toBe(true)

  return slug
}

async function clickPinAndWaitForSave(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => {
      return response.url().includes('/api/v1/chats/history/pin')
        && response.ok()
    }),
    page.locator(PIN_BUTTON).click(),
  ])
  await expect(page.locator(PIN_BUTTON)).toBeEnabled()
}

async function openContextPanel(page: Page): Promise<void> {
  await page.locator(SIDEBAR).hover()
  await expect(page.locator(CONTEXT_TRIGGER)).toBeVisible({ timeout: 15_000 })
  await page.locator(CONTEXT_TRIGGER).hover()
  await page.locator(CONTEXT_TRIGGER).click()
  await expect(page.locator(SIDE_PANEL)).toBeVisible()
  await expect(page.locator(CONTEXT_PANEL)).toBeVisible()
}

test.describe('chat context panel pin', () => {
  test('pins from the panel, History shows it pinned, then unpins',
    async ({ page }) => {
      const title = `Pin from panel ${Date.now().toString(36)}`
      const slug = await seedChat(page, title)

      await page.goto(`/chats/${slug}`)
      await waitForHydration(page)
      await openContextPanel(page)

      const pinButton = page.locator(PIN_BUTTON)

      await expect(pinButton).toHaveText('Pin')

      await clickPinAndWaitForSave(page)

      await expect(pinButton).toHaveText('Unpin')

      await page.goto('/chats/history')
      await waitForHydration(page)

      await expect(page.locator(PINNED_LIST).getByText(title))
        .toBeVisible({ timeout: 15_000 })

      await page.goto(`/chats/${slug}`)
      await waitForHydration(page)
      await openContextPanel(page)

      await expect(page.locator(PIN_BUTTON)).toHaveText('Unpin')

      await clickPinAndWaitForSave(page)

      await expect(page.locator(PIN_BUTTON)).toHaveText('Pin')

      await page.goto('/chats/history')
      await waitForHydration(page)

      await expect(page.getByText(title).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator(PINNED_LIST).getByText(title))
        .toHaveCount(0)
    })

  test('the quick search shows the chat pinned right after pinning',
    async ({ page }) => {
      const title = `Pin and search ${Date.now().toString(36)}`
      const slug = await seedChat(page, title)

      await page.goto(`/chats/${slug}`)
      await waitForHydration(page)
      await openContextPanel(page)
      await clickPinAndWaitForSave(page)
      await expect(page.locator(PIN_BUTTON)).toHaveText('Unpin')

      const modal = page.getByTestId('search-modal')

      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+k')
        await expect(modal).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })

      const row = modal.getByTestId('search-result-row')
        .filter({ hasText: title })

      await expect(row.getByTestId('chat-pinned-badge')).toBeVisible()
    })

  test('keeps the four action buttons inside the panel at 375 px',
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })

      const slug = await seedChat(page, `Pin narrow ${Date.now().toString(36)}`)

      await page.goto(`/chats/${slug}`)
      await waitForHydration(page)
      await openContextPanel(page)

      const panel = page.locator(CONTEXT_PANEL)

      await expect(page.locator(PIN_BUTTON)).toBeVisible()

      const panelBox = await panel.boundingBox()

      for (const testId of [
        'chat-context-branch',
        'chat-context-share',
        'chat-context-pin',
        'chat-context-memory-exclusion',
      ]) {
        const box = await page.getByTestId(testId).boundingBox()

        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x - 1)
        expect(box!.x + box!.width)
          .toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1)
      }
    })
})
