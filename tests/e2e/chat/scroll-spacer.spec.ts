import type { Page } from '@playwright/test'
import { devices, expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

interface ChatLayoutMetrics {
  userCount: number
  assistantCount: number
  scrollTop: number
  scrollHeight: number
  scrollContainerHeight: number
  chatInputTop: number | null
  chatInputClassName: string
  lastUserTopRelative: number | null
  lastAssistantTopRelative: number | null
  gapFromLastAssistantToInput: number | null
}

const TOP_ALIGNMENT_MAX: number = 160
const GAP_MIN: number = 4
const GAP_MAX: number = 36
const LARGE_EMPTY_SPACE_MIN: number = 120

test.use({
  ...devices['iPhone 14 Pro Max'],
  defaultBrowserType: undefined,
})

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

async function openCase(
  page: Page,
  url: string,
): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)

  await expect(page.locator('[data-testid="chat-messages-container"]')).toBeVisible()
  await expect(
    page.locator('textarea[placeholder="Type your message here..."]'),
  ).toBeVisible()

  await expect.poll(async () => {
    const metrics = await getChatLayoutMetrics(page)

    return metrics.scrollContainerHeight > 0 && metrics.chatInputTop !== null
  }).toBe(true)
}

async function waitForAssistantMessageCount(
  page: Page,
  count: number,
): Promise<void> {
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(count, {
    timeout: 30_000,
  })
}

async function waitForChatReadyState(page: Page): Promise<void> {
  await expect(
    page.locator('button[title="Stop"]').first(),
  ).toBeHidden({ timeout: 30_000 })
}

async function waitForLatestAssistantToHaveText(
  page: Page,
): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const assistantMessages = Array.from(
        document.querySelectorAll(
          '[data-role="assistant"]:not([data-hide-content="true"])',
        ),
      ) as HTMLElement[]
      const latestAssistantMessage = assistantMessages.at(-1)

      if (!latestAssistantMessage) {
        return false
      }

      return Boolean(latestAssistantMessage.textContent?.trim().length)
    })
  }, {
    timeout: 30_000,
  }).toBe(true)
}

async function expectRegenerateLoaderTransition(
  page: Page,
  expectedAssistantCount: number,
): Promise<void> {
  const loader = page.locator('[data-testid="chat-loader"]').first()

  await expect(loader).toBeAttached()
  await expect.poll(async () => {
    const className = await loader.getAttribute('class')

    if (!className) {
      return false
    }

    return !className.includes('opacity-0')
  }, {
    timeout: 10_000,
  }).toBe(true)

  await waitForAssistantMessageCount(page, expectedAssistantCount)
  await waitForLatestAssistantToHaveText(page)

  await expect.poll(async () => {
    const className = await loader.getAttribute('class')

    if (!className) {
      return false
    }

    return className.includes('opacity-0')
  }, {
    timeout: 10_000,
  }).toBe(true)
}

async function getChatLayoutMetrics(
  page: Page,
): Promise<ChatLayoutMetrics> {
  return page.evaluate(() => {
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement | null
    const scrollContainer = messagesRoot?.parentElement as HTMLElement | null
    const chatInputTextarea = document.querySelector(
      'textarea[placeholder="Type your message here..."]',
    ) as HTMLTextAreaElement | null
    const chatInput = chatInputTextarea?.closest('.fixed') as HTMLElement | null

    const userMessages = Array.from(
      document.querySelectorAll(
        '[data-role="user"]:not([data-hide-content="true"])',
      ),
    ) as HTMLElement[]
    const assistantMessages = Array.from(
      document.querySelectorAll(
        '[data-role="assistant"]:not([data-hide-content="true"])',
      ),
    ) as HTMLElement[]

    const lastUserMessage = userMessages.at(-1) || null
    const lastAssistantMessage = assistantMessages.at(-1) || null
    const containerRect = scrollContainer?.getBoundingClientRect() || null
    const chatInputRect = chatInput?.getBoundingClientRect() || null

    function getBubbleRect(
      message: HTMLElement | null,
    ): DOMRect | null {
      if (!message) {
        return null
      }

      const bubble = message.querySelector('.chat-bubble') as HTMLElement | null

      if (!bubble) {
        return null
      }

      return bubble.getBoundingClientRect()
    }

    const lastUserRect = getBubbleRect(lastUserMessage)
    const lastAssistantRect = getBubbleRect(lastAssistantMessage)

    return {
      userCount: userMessages.length,
      assistantCount: assistantMessages.length,
      scrollTop: scrollContainer?.scrollTop || 0,
      scrollHeight: scrollContainer?.scrollHeight || 0,
      scrollContainerHeight: scrollContainer?.clientHeight || 0,
      chatInputTop: chatInputRect ? chatInputRect.top : null,
      chatInputClassName: chatInput?.className || '',
      lastUserTopRelative: (lastUserRect && containerRect)
        ? lastUserRect.top - containerRect.top
        : null,
      lastAssistantTopRelative: (lastAssistantRect && containerRect)
        ? lastAssistantRect.top - containerRect.top
        : null,
      gapFromLastAssistantToInput: (lastAssistantRect && chatInputRect)
        ? chatInputRect.top - lastAssistantRect.bottom
        : null,
    }
  })
}

async function scrollConversationToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement | null
    const scrollContainer = messagesRoot?.parentElement as HTMLElement | null

    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollTop = 0
  })
}

async function scrollConversationToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement | null
    const scrollContainer = messagesRoot?.parentElement as HTMLElement | null

    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight
  })
}

async function expectGapNearInput(
  page: Page,
  minimum: number = GAP_MIN,
  maximum: number = GAP_MAX,
): Promise<void> {
  await expect.poll(async () => {
    const metrics = await getChatLayoutMetrics(page)
    const gap = metrics.gapFromLastAssistantToInput

    if (gap === null) {
      return false
    }

    return gap >= minimum && gap <= maximum
  }).toBe(true)
}

test.describe('Short chat spacer and scroll behavior', () => {
  test('Case #1: one short user message stays at top', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=short&messages=1')

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.userCount).toBe(1)
    expect(metrics.assistantCount).toBe(0)
    expect(metrics.lastUserTopRelative).not.toBeNull()
    expect(
      metrics.lastUserTopRelative as number,
    ).toBeLessThan(TOP_ALIGNMENT_MAX)
  })

  test('Case #2: user + assistant short pair stays at top', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=short&messages=2')

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.userCount).toBe(1)
    expect(metrics.assistantCount).toBe(1)
    expect(metrics.lastUserTopRelative).not.toBeNull()
    expect(metrics.lastAssistantTopRelative).not.toBeNull()
    expect(
      metrics.lastUserTopRelative as number,
    ).toBeLessThan(TOP_ALIGNMENT_MAX)
    expect(
      (metrics.lastAssistantTopRelative as number)
      > (metrics.lastUserTopRelative as number),
    ).toBe(true)
  })

  test('Case #3: many short messages end above input with visual gap', async ({
    page,
  }) => {
    await openCase(page, '/chats/test?scenario=short&messages=20')

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.userCount).toBe(10)
    expect(metrics.assistantCount).toBe(10)

    await expectGapNearInput(page)
  })

  test('Case #4: regenerate from one short user message keeps pair at top', async ({
    page,
  }) => {
    await openCase(
      page,
      '/chats/test?scenario=short&messages=1&regenerate',
    )
    await expectRegenerateLoaderTransition(page, 1)
    await waitForChatReadyState(page)

    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toContainText('This is a short response from the AI.', {
      timeout: 30_000,
    })

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.lastUserTopRelative).not.toBeNull()
    expect(metrics.lastAssistantTopRelative).not.toBeNull()
    expect(
      metrics.lastUserTopRelative as number,
    ).toBeLessThan(TOP_ALIGNMENT_MAX)
    expect(
      (metrics.lastAssistantTopRelative as number)
      > (metrics.lastUserTopRelative as number),
    ).toBe(true)
  })

  test('Case #5: regenerate with many short messages pushes last user to top', async ({
    page,
  }) => {
    await openCase(
      page,
      '/chats/test?scenario=short&messages=21&regenerate',
    )
    await expectRegenerateLoaderTransition(page, 11)
    await waitForChatReadyState(page)

    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toContainText('This is a short response from the AI.', {
      timeout: 30_000,
    })

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.userCount).toBe(11)
    expect(metrics.assistantCount).toBe(11)
    expect(metrics.lastUserTopRelative).not.toBeNull()
    expect(metrics.lastAssistantTopRelative).not.toBeNull()
    expect(
      metrics.scrollContainerHeight,
    ).toBeGreaterThan(0)
    expect(
      (metrics.lastAssistantTopRelative as number)
      < metrics.scrollContainerHeight * 0.95,
    ).toBe(true)
    expect(
      metrics.gapFromLastAssistantToInput === null
      || metrics.gapFromLastAssistantToInput > -120,
    ).toBe(true)
  })

  test('Case #6: manual scroll up shows button and returns pair to top on click', async ({
    page,
  }) => {
    await openCase(
      page,
      '/chats/test?scenario=short&messages=21&regenerate',
    )
    await expectRegenerateLoaderTransition(page, 11)
    await waitForChatReadyState(page)

    const baselineMetrics = await getChatLayoutMetrics(page)

    expect(baselineMetrics.scrollTop).toBeGreaterThan(100)

    await page.evaluate(() => {
      const messagesRoot = document.querySelector(
        '[data-testid="chat-messages-container"]',
      ) as HTMLElement | null
      const scrollContainer = messagesRoot?.parentElement as HTMLElement | null

      if (!scrollContainer) {
        return
      }

      scrollContainer.scrollTop = Math.max(
        0,
        scrollContainer.scrollTop - 300,
      )
    })

    const scrollToBottomButton = page.locator('button[title="Scroll to bottom"]')

    await expect(scrollToBottomButton).toBeAttached()

    await scrollToBottomButton.evaluate((element) => {
      ;(element as HTMLButtonElement).click()
    })

    await expect.poll(async () => {
      const metrics = await getChatLayoutMetrics(page)

      if (
        metrics.lastUserTopRelative === null
        || metrics.lastAssistantTopRelative === null
        || metrics.gapFromLastAssistantToInput === null
      ) {
        return false
      }

      return metrics.lastAssistantTopRelative > metrics.lastUserTopRelative
        && metrics.gapFromLastAssistantToInput > -200
    }, {
      timeout: 15_000,
    }).toBe(true)
  })
})

test.describe('Long chat spacer and scroll behavior', () => {
  test('Case #1: long user message shows only lower part after spacer push', async ({
    page,
  }) => {
    await openCase(page, '/chats/test?scenario=long&messages=1')

    await expect.poll(async () => {
      const metrics = await getChatLayoutMetrics(page)

      return metrics.lastUserTopRelative !== null
        && metrics.lastUserTopRelative < -100
        && metrics.scrollTop > 0
    }).toBe(true)
  })

  test('Case #2: long pair ends above input with padding', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=long&messages=2')

    const metrics = await getChatLayoutMetrics(page)

    expect(metrics.userCount).toBe(1)
    expect(metrics.assistantCount).toBe(1)

    await expectGapNearInput(page)
  })

  test('Case #3: regenerate long flow keeps tall behavior and reset on button click', async ({
    page,
  }) => {
    await openCase(
      page,
      '/chats/test?scenario=long&messages=1&regenerate',
    )
    await expectRegenerateLoaderTransition(page, 1)
    await waitForChatReadyState(page)

    await expect(
      page.locator('[data-role="assistant"]').last(),
    ).toContainText('Lorem ipsum dolor sit amet', {
      timeout: 30_000,
    })

    await expect.poll(async () => {
      const metrics = await getChatLayoutMetrics(page)

      return metrics.lastUserTopRelative !== null
        && metrics.lastUserTopRelative < -100
    }).toBe(true)

    await scrollConversationToBottom(page)

    await expect.poll(async () => {
      const metrics = await getChatLayoutMetrics(page)
      const gap = metrics.gapFromLastAssistantToInput

      return gap !== null && gap > LARGE_EMPTY_SPACE_MIN
    }).toBe(true)

    await scrollConversationToTop(page)

    const scrollToBottomButton = page.locator('button[title="Scroll to bottom"]')

    await expect(scrollToBottomButton).toBeVisible()
    await scrollToBottomButton.click()

    await expectGapNearInput(page)
  })
})
