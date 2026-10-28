import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

interface AssistantContainerSample {
  visibleAssistantContainers: number
  progress: number
  hiddenProgress: number
}

type WindowWithAssistantContainerSampler = typeof window & {
  __assistantContainerSamples?: AssistantContainerSample[]
  __assistantContainerSamplerHandle?: number
}

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/api/v1/profiles/keys**',
    async (route) => {
      await route.fulfill({
        json: {
          keys: [{ provider: 'google', hasKey: true }],
        },
      })
    },
  )
})

async function startAssistantContainerSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sampledWindow = window as WindowWithAssistantContainerSampler

    sampledWindow.__assistantContainerSamples = []

    function countVisibleAssistantContainersAfterLastUser(): number {
      const userMessages = document.querySelectorAll('[data-role="user"]')
      const lastUserMessage = userMessages[userMessages.length - 1]
      const assistantContainers = document.querySelectorAll(
        '.chat.chat-start',
      )

      return Array.from(assistantContainers).filter((container) => {
        if (container.closest('[data-testid="chat-loader"]')) {
          return false
        }

        if ((container as HTMLElement).offsetParent === null) {
          return false
        }

        if (!lastUserMessage) {
          return true
        }

        return Boolean(
          lastUserMessage.compareDocumentPosition(container)
          & Node.DOCUMENT_POSITION_FOLLOWING,
        )
      }).length
    }

    function sample() {
      sampledWindow.__assistantContainerSamples?.push({
        visibleAssistantContainers:
          countVisibleAssistantContainersAfterLastUser(),
        progress: document.querySelectorAll(
          '[data-testid="generated-image-progress"]',
        ).length,
        hiddenProgress: document.querySelectorAll(
          '[data-role="assistant"][data-hide-content="true"] '
          + '[data-testid="generated-image-progress"]',
        ).length,
      })
      sampledWindow.__assistantContainerSamplerHandle
        = requestAnimationFrame(sample)
    }

    sample()
  })
}

async function stopAssistantContainerSampler(
  page: Page,
): Promise<AssistantContainerSample[]> {
  return page.evaluate(() => {
    const sampledWindow = window as WindowWithAssistantContainerSampler

    cancelAnimationFrame(sampledWindow.__assistantContainerSamplerHandle ?? 0)

    return sampledWindow.__assistantContainerSamples ?? []
  })
}

async function expectSingleAssistantMessageThroughImageTurn(
  page: Page,
  url: string,
): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)

  await page.locator('[data-testid="current-model-trigger"]').click()
  await page.getByRole('button', { name: 'Choose Nano Banana 2', exact: true })
    .click()
  await page.locator('textarea').fill('Fill this room with my favourite things')

  await startAssistantContainerSampler(page)
  await page.getByRole('button', { name: 'Send Message' }).click()

  await expect(
    page.locator('[data-testid="generated-image-ready"]'),
  ).toBeVisible({ timeout: 15_000 })

  const samples = await stopAssistantContainerSampler(page)

  expect(samples.length).toBeGreaterThan(10)
  expect(samples.some(sample => sample.progress > 0)).toBe(true)

  const framesWithSeveralAssistantContainers = samples.filter((sample) => {
    return sample.visibleAssistantContainers > 1
  })

  expect(framesWithSeveralAssistantContainers).toHaveLength(0)

  for (const sample of samples) {
    expect(sample.progress).toBeLessThanOrEqual(1)
    expect(sample.hiddenProgress).toBe(0)
  }
}

test('direct image turn that starts with the past-chat pre-retrieval chip '
  + 'renders a single assistant message', async ({ page }) => {
  await expectSingleAssistantMessageThroughImageTurn(
    page,
    '/chats/test?scenario=image&imagePreRetrievalFirst',
  )
})

test('direct image turn with the pre-retrieval chip and reasoning before '
  + 'the tool call renders a single assistant message', async ({ page }) => {
  await expectSingleAssistantMessageThroughImageTurn(
    page,
    '/chats/test?scenario=image&imagePreRetrievalFirst&imageReasoningFirst',
  )
})
