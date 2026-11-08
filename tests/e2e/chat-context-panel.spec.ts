import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/auth'

const SIDEBAR = '[data-testid="sidebar"]'
const CONTEXT_TRIGGER = '[data-testid="sidebar-chat-context"]'
const CONTEXT_BADGE = '[data-testid="sidebar-chat-context-badge"]'
const MORE_TRIGGER = '[data-testid="sidebar-more-features"]'
const SIDE_PANEL = '[data-testid="side-panel"]'
const CONTEXT_PANEL = '[data-testid="chat-context-panel"]'
const SHARE_MODAL = '[data-testid="chat-share-modal"]'

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

function createContextFixture(slug: string) {
  return {
    chat: {
      slug,
      title: 'Context panel chat',
      project: null,
      memoryExcluded: false,
      share: { active: false },
      cost: null,
      models: [],
    },
    outputs: [
      {
        id: 'research:message-1',
        sectionId: 'research-reports',
        kind: 'research',
        title: 'Research report',
        messageId: 'message-1',
        meta: {},
      },
      {
        id: 'research:message-2',
        sectionId: 'research-reports',
        kind: 'research',
        title: 'Second report',
        messageId: 'message-2',
        meta: {},
      },
    ],
    inputs: [
      {
        id: 'file:/files/key-1',
        sectionId: 'uploaded-files',
        kind: 'file',
        title: 'report.pdf',
        messageId: 'message-1',
        meta: { url: '/files/key-1', mediaType: 'application/pdf' },
      },
    ],
    used: [
      {
        id: 'source:https://example.com/a',
        sectionId: 'web-sources',
        kind: 'web-source',
        title: 'Example article',
        messageId: 'message-2',
        href: 'https://example.com/a',
        meta: { domain: 'example.com' },
      },
    ],
    counts: { outputs: 2, inputs: 1, used: 1 },
    truncated: false,
  }
}

async function seedChat(page: Page): Promise<string> {
  const title = `Context panel ${Date.now().toString(36)}`
  const createResponse = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: title }],
      tools: [],
    },
  })

  expect(createResponse.ok()).toBe(true)

  const { slug } = await createResponse.json()

  return slug
}

async function openChatWithContext(page: Page): Promise<string> {
  const slug = await seedChat(page)

  await page.route(`**/api/v1/chats/${slug}/context`, async (route) => {
    await route.fulfill({ json: createContextFixture(slug) })
  })
  await page.goto(`/chats/${slug}`)
  await waitForHydration(page)

  return slug
}

async function revealSidebar(page: Page): Promise<void> {
  await page.locator(SIDEBAR).hover()
}

async function openContextPanel(page: Page): Promise<void> {
  await revealSidebar(page)
  await expect(page.locator(CONTEXT_TRIGGER)).toBeVisible({ timeout: 15_000 })
  await page.locator(CONTEXT_TRIGGER).hover()
  await page.locator(CONTEXT_TRIGGER).click()
  await expect(page.locator(SIDE_PANEL)).toBeVisible()
  await expect(page.locator(CONTEXT_PANEL)).toBeVisible()
}

test.describe('chat context panel', () => {
  test('slot 5 is the Chat button with an outputs badge, not ⋯ More',
    async ({ page }) => {
      await openChatWithContext(page)
      await revealSidebar(page)

      await expect(page.locator(CONTEXT_TRIGGER)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator(CONTEXT_BADGE)).toHaveText('2')
      await expect(page.locator(MORE_TRIGGER)).toHaveCount(0)
    })

  test('opens from the Chat button and lists the non-empty sections',
    async ({ page }) => {
      await openChatWithContext(page)
      await openContextPanel(page)

      await expect(page.getByTestId('chat-context-title'))
        .toHaveText('Context panel chat')
      await expect(page.getByTestId('chat-context-section-outputs'))
        .toBeVisible()
      await expect(page.getByTestId('chat-context-section-inputs'))
        .toBeVisible()
      await expect(page.getByTestId('chat-context-section-used'))
        .toBeVisible()
      await expect(page.getByTestId('chat-context-item-file'))
        .toContainText('report.pdf')

      const source = page.getByTestId('chat-context-item-web-source')

      await expect(source).toHaveAttribute('href', 'https://example.com/a')
      await expect(source).toHaveAttribute('target', '_blank')
      await expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    })

  test('shows Branch and Share in the panel header, and Share opens the '
    + 'share modal', async ({ page }) => {
    await openChatWithContext(page)
    await openContextPanel(page)

    await expect(page.getByTestId('chat-context-branch')).toBeVisible()
    await expect(page.getByTestId('chat-context-memory-exclusion'))
      .toBeVisible()

    await page.getByTestId('chat-context-share').click()

    await expect(page.locator(SHARE_MODAL)).toBeVisible()
  })

  test('closes the panel when the Chat button is clicked again',
    async ({ page }) => {
      await openChatWithContext(page)
      await openContextPanel(page)

      await page.locator(CONTEXT_TRIGGER).click()

      await expect(page.locator(SIDE_PANEL)).toBeHidden()
    })

  test('keeps ⋯ More on pages that are not chats', async ({ page }) => {
    await page.goto('/profile/keys')
    await waitForHydration(page)
    await revealSidebar(page)

    await expect(page.locator(MORE_TRIGGER)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(CONTEXT_TRIGGER)).toHaveCount(0)
  })
})
