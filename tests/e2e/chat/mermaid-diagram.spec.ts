import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

async function openCase(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)

  await expect(
    page.locator('[data-testid="chat-messages-container"]'),
  ).toBeVisible()
}

test.describe('Mermaid diagrams', () => {
  test('renders a persisted ```mermaid block as an svg', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=2')

    const diagrams = page.locator('[data-testid="mermaid-diagram"]')

    await expect(diagrams.first().locator('svg')).toBeVisible({
      timeout: 15_000,
    })
    await expect(diagrams).toHaveCount(3)
    await expect(diagrams.locator('svg')).toHaveCount(3)
    await expect(diagrams.first()).toContainText('KV hit?')
    await expect(diagrams.nth(1)).toContainText('Stream tokens')
    await expect(diagrams.nth(2)).toContainText('Tokens by provider')
    await expect(page.locator('[data-testid="mermaid-error"]')).toHaveCount(0)
  })

  test('toggles between the diagram and its source', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=2')

    const diagrams = page.locator('[data-testid="mermaid-diagram"]')

    await expect(diagrams.locator('svg')).toHaveCount(3, { timeout: 15_000 })

    await page.locator('[data-testid="mermaid-toggle"]').first().click()

    await expect(diagrams).toHaveCount(2)
    await expect(
      page.locator('[data-testid="chat-messages-container"]'),
    ).toContainText('flowchart LR')
  })

  test('renders the diagram once the streamed fence closes', async ({
    page,
  }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=1&regenerate')

    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.locator('button[data-testid="stop-generation"]').first(),
    ).toBeHidden({ timeout: 30_000 })

    await expect(
      page.locator('[data-testid="mermaid-diagram"] svg').first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})
