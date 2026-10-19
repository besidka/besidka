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

    const diagram = page.locator('[data-testid="mermaid-diagram"]')

    await expect(diagram.locator('svg')).toBeVisible({ timeout: 15_000 })
    await expect(diagram).toContainText('Render diagram')
    await expect(page.locator('[data-testid="mermaid-error"]')).toHaveCount(0)
  })

  test('toggles between the diagram and its source', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=2')

    const diagram = page.locator('[data-testid="mermaid-diagram"]')

    await expect(diagram.locator('svg')).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-testid="mermaid-toggle"]').click()

    await expect(diagram).toHaveCount(0)
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
      page.locator('[data-testid="mermaid-diagram"] svg'),
    ).toBeVisible({ timeout: 15_000 })
  })
})
