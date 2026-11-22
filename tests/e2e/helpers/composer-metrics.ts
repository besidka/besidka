import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { waitForHydration } from './auth'

export interface ComposerMetrics {
  composerHeight: number
  spacerHeight: number
  scrollHeight: number
  scrollTop: number
  lastUserTop: number
}

/**
 * The geometry the chat scroll spacer decides: the composer height, the
 * spacer under the messages, the scroll position and where the last user
 * message sits relative to the top of the scroll container.
 */
export async function readComposerMetrics(
  page: Page,
): Promise<ComposerMetrics> {
  return page.evaluate(() => {
    const composer = document.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLElement
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement
    const scrollContainer = messagesRoot.parentElement as HTMLElement
    const spacer = scrollContainer.lastElementChild as HTMLElement
    const lastUser = Array.from(
      document.querySelectorAll('[data-role="user"] .chat-bubble'),
    ).at(-1) as HTMLElement | undefined
    const containerTop = scrollContainer.getBoundingClientRect().top

    return {
      composerHeight: composer.offsetHeight,
      spacerHeight: spacer.offsetHeight,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
      lastUserTop: lastUser
        ? lastUser.getBoundingClientRect().top - containerTop
        : -1,
    }
  })
}

export async function openChatCase(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)

  await expect(page.getByTestId('chat-input-textarea')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

export async function settleLayout(page: Page): Promise<void> {
  await page.waitForTimeout(600)
}
