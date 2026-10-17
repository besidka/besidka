import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const CHAT_URL = '/chats/test?scenario=short&messages=2'
const NEW_CHAT_URL = '/chats/new'
const GREETING_TEXT = 'How can I assist you today?'
const NOT_FOUND_TOAST_PATTERN = /object can not be found here/i
const DOM_THROW_MARKER = '[dom-mutation-throw]'
const FIRST_TURN_CHAT_SLUG = 'e2e-new-chat-navigation'
const FIRST_TURN_MESSAGE = 'Hello from the first turn'
const SETTLE_TIMEOUT_MS = 4_000

test.describe.configure({ timeout: 45_000 })

interface NavigationDiagnostics {
  consoleErrors: string[]
  pageErrors: string[]
}

function collectDiagnostics(page: Page): NavigationDiagnostics {
  const diagnostics: NavigationDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
  }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text())
    }
  })

  page.on('pageerror', (exception) => {
    diagnostics.pageErrors.push(
      `${exception.name}: ${exception.message}\n${exception.stack}`,
    )
  })

  return diagnostics
}

async function instrumentDomMutations(page: Page): Promise<void> {
  await page.addInitScript((marker: string) => {
    const methodNames = ['removeChild', 'insertBefore', 'replaceChild'] as const

    methodNames.forEach((methodName) => {
      const original = Node.prototype[methodName] as (
        ...args: unknown[]
      ) => unknown

      Object.defineProperty(Node.prototype, methodName, {
        configurable: true,
        writable: true,
        value(this: Node, ...args: unknown[]) {
          try {
            return original.apply(this, args)
          } catch (exception) {
            const reason = exception instanceof Error
              ? `${exception.name}: ${exception.message}`
              : String(exception)

            console.error(
              `${marker} ${methodName} ${reason}\n${new Error().stack}`,
            )

            throw exception
          }
        },
      })
    })
  }, DOM_THROW_MARKER)
}

async function openChatPage(page: Page): Promise<void> {
  await page.goto(CHAT_URL)
  await waitForHydration(page)
  await expect(page.locator('[data-role="assistant"]').first()).toBeVisible()
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1, {
    timeout: 30_000,
  })
}

async function openChatPageClientSide(page: Page): Promise<void> {
  await page.evaluate((url: string) => {
    const root = document.querySelector('#__nuxt') as unknown as {
      __vue_app__: {
        config: {
          globalProperties: {
            $router: { push: (target: string) => Promise<void> }
          }
        }
      }
    }

    return root.__vue_app__.config.globalProperties.$router.push(url)
  }, CHAT_URL)

  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1, {
    timeout: 30_000,
  })
}

async function mockFirstTurnChat(page: Page): Promise<void> {
  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await route.fulfill({
      json: { keys: [{ provider: 'google', hasKey: true }] },
    })
  })

  await page.route('**/api/v1/chats/new', async (route) => {
    await route.fulfill({ json: { slug: FIRST_TURN_CHAT_SLUG } })
  })

  await page.route(
    `**/api/v1/chats/${FIRST_TURN_CHAT_SLUG}/title`,
    async (route) => {
      await route.fulfill({ json: { title: 'First turn' } })
    },
  )

  await page.route(
    `**/api/v1/chats/${FIRST_TURN_CHAT_SLUG}`,
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            id: 1,
            slug: FIRST_TURN_CHAT_SLUG,
            title: '',
            projectId: null,
            branchedFromShareSlug: null,
            activeResearchJob: null,
            messages: [
              {
                id: 'e2e-first-turn-user-message',
                publicId: 'e2e-first-turn-user-message',
                role: 'user',
                parts: [{ type: 'text', text: FIRST_TURN_MESSAGE }],
                tools: [],
                reasoning: 'off',
                createdAt: new Date().toISOString(),
                usage: null,
              },
            ],
          },
        })

        return
      }

      const requestUrl = new URL(route.request().url())
      const response = await route.fetch({
        url: `${requestUrl.origin}/api/v1/chats/test?scenario=short`,
      })

      await route.fulfill({ response })
    },
  )
}

async function expectCleanNewChatPage(
  page: Page,
  diagnostics: NavigationDiagnostics,
): Promise<void> {
  await expect(page).toHaveURL(NEW_CHAT_URL)
  await expect(page.getByText(GREETING_TEXT)).toBeVisible()

  await page.waitForTimeout(SETTLE_TIMEOUT_MS)

  await expect(page.getByText(GREETING_TEXT)).toBeVisible()
  await expect(page.getByText(NOT_FOUND_TOAST_PATTERN)).toHaveCount(0)
  await expect(page.locator('[role="alert"].alert-error')).toHaveCount(0)

  const domThrows = diagnostics.consoleErrors.filter((entry) => {
    return entry.includes(DOM_THROW_MARKER)
  })

  expect(domThrows, domThrows.join('\n\n')).toEqual([])
  expect(diagnostics.pageErrors, diagnostics.pageErrors.join('\n\n'))
    .toEqual([])
}

test.describe('navigating back to a new chat from a chat page', () => {
  let diagnostics: NavigationDiagnostics

  test.beforeEach(async ({ page }) => {
    diagnostics = collectDiagnostics(page)

    await instrumentDomMutations(page)
  })

  test('sidebar new chat button shows the greeting without errors', async ({
    page,
  }) => {
    await openChatPage(page)

    await page.getByRole('link', { name: 'Start new chat' }).click()

    await expectCleanNewChatPage(page, diagnostics)
  })

  test('browser back from a chat page shows the greeting without errors', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_URL)
    await waitForHydration(page)
    await expect(page.getByText(GREETING_TEXT)).toBeVisible()

    await openChatPageClientSide(page)

    await page.goBack()

    await expectCleanNewChatPage(page, diagnostics)
  })

  test('first turn sent from the new chat page returns to a clean new chat',
    async ({ page }) => {
      await mockFirstTurnChat(page)

      await page.goto(NEW_CHAT_URL)
      await waitForHydration(page)

      await page.locator('textarea').fill(FIRST_TURN_MESSAGE)
      await page.getByRole('button', { name: 'Send Message' }).click()
      await page.waitForURL(`**/chats/${FIRST_TURN_CHAT_SLUG}`)

      await expect(page.locator('[data-role="assistant"]')).toHaveCount(1, {
        timeout: 30_000,
      })

      await page.getByRole('link', { name: 'Start new chat' }).click()

      await expectCleanNewChatPage(page, diagnostics)
    })

  test('repeated round trips keep the new chat page healthy', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_URL)
    await waitForHydration(page)

    for (let round = 0; round < 3; round++) {
      await openChatPageClientSide(page)

      await page.getByRole('link', { name: 'Start new chat' }).click()

      await expectCleanNewChatPage(page, diagnostics)
    }
  })
})
