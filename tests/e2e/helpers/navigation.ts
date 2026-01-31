import type { Page } from '@playwright/test'

/**
 * Navigate to a specific page
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/**
 * Navigate to chat history
 */
export async function goToChatHistory(page: Page) {
  await page.click('[data-testid="sidebar-toggle"]').catch(() => {})
  await page.click('a[href*="/chats"]')
}

/**
 * Navigate to settings
 */
export async function goToSettings(page: Page) {
  await page.click('[data-testid="sidebar-toggle"]').catch(() => {})
  await page.click('a[href*="/settings"]')
}

/**
 * Open a specific chat from the sidebar
 */
export async function openChatFromSidebar(page: Page, chatTitle: string) {
  await page.click(`[data-testid="sidebar-toggle"]`).catch(() => {})
  await page.click(`a:has-text("${chatTitle}")`)
}

/**
 * Wait for page to be fully loaded
 */
export async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForLoadState('domcontentloaded')
}
