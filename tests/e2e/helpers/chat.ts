import type { Page } from '@playwright/test'

/**
 * Create a new chat and send the first message
 */
export async function createChat(page: Page, message: string) {
  await page.goto('/chats/new')
  await sendMessage(page, message)
}

/**
 * Send a message in the current chat
 */
export async function sendMessage(page: Page, message: string) {
  const input = page.locator('textarea[placeholder*="Message"]').first()
  await input.fill(message)
  await input.press('Enter')
}

/**
 * Wait for AI response to complete
 */
export async function waitForResponse(page: Page, timeout: number = 30000) {
  // Wait for the loading indicator to appear and then disappear
  await page.waitForSelector('[data-testid="ai-reasoning"]', { timeout: 5000 }).catch(() => {})
  await page.waitForSelector('[data-testid="ai-reasoning"]', { state: 'hidden', timeout }).catch(() => {})
}

/**
 * Get all messages in the current chat
 */
export async function getMessages(page: Page) {
  return await page.locator('[data-testid="chat-message"]').all()
}

/**
 * Get the latest message text
 */
export async function getLatestMessageText(page: Page): Promise<string> {
  const messages = await getMessages(page)
  if (messages.length === 0) return ''
  const lastMessage = messages[messages.length - 1]
  return await lastMessage.textContent() || ''
}

/**
 * Stop the current AI response generation
 */
export async function stopGeneration(page: Page) {
  await page.click('button[aria-label="Stop generating"]')
}

/**
 * Regenerate the last AI response
 */
export async function regenerateResponse(page: Page) {
  await page.click('button[aria-label="Regenerate response"]')
  await waitForResponse(page)
}

/**
 * Update the chat title
 */
export async function updateChatTitle(page: Page, newTitle: string) {
  await page.click('[data-testid="chat-title"]')
  await page.fill('input[name="title"]', newTitle)
  await page.press('input[name="title"]', 'Enter')
}

/**
 * Delete the current chat
 */
export async function deleteChat(page: Page) {
  await page.click('button[aria-label="Delete chat"]')
  await page.click('button:has-text("Confirm")')
  await page.waitForURL('/chats/new')
}
