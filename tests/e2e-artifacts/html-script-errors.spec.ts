import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const FIXTURES = join(process.cwd(), 'tests/fixtures/artifacts')
const BROKEN_QUIZ = readFileSync(
  join(FIXTURES, 'kyiv-quiz-syntax-error.html'),
  'utf8',
)
const WORKING_QUIZ = readFileSync(join(FIXTURES, 'kyiv-quiz.html'), 'utf8')
const BROKEN_LINE = 44
const SCRIPT_START_LINE = 30

async function renderHtml(page: Page, content: string) {
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
  await page.evaluate(() => {
    (window as any).harness.mount({})
  })
  await page.waitForFunction(() => {
    return (window as any).harness.state.ready === true
  })
  await page.evaluate((payload) => {
    (window as any).harness.sendResult(payload)
  }, { kind: 'html', title: 'Тест: історія Києва', content })
}

async function errorMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return (window as any).harness.state.messages
      .filter((message: { level: string }) => {
        return message.level === 'error'
      })
      .map((message: { data: { message: string } }) => {
        return message.data.message
      })
  })
}

test.describe('HTML artifact script errors', () => {
  test('names the artifact line of a generated syntax error', async ({ page, browserName }) => {
    await renderHtml(page, BROKEN_QUIZ)

    await expect.poll(() => errorMessages(page)).toHaveLength(1)

    const [message] = await errorMessages(page)

    if (browserName === 'webkit') {
      expect(message).toContain(
        `The error is in the artifact's script that starts on line ${SCRIPT_START_LINE}.`,
      )
    } else {
      expect(message).toMatch(
        new RegExp(`^SyntaxError in the artifact's script \\(line ${BROKEN_LINE}(, column \\d+)?\\): Unexpected token '}'$`),
      )
    }

    expect(message).not.toContain('replaceWith')
    expect(message).not.toContain('Failed to execute')
  })

  test('runs a valid quiz with the same structure without errors', async ({ page }) => {
    await renderHtml(page, WORKING_QUIZ)

    const frame = page.frameLocator('[data-testid="artifact-frame"]')

    await expect(frame.locator('.option').first()).toBeVisible()
    await frame.locator('.option').first().click()
    await expect(frame.locator('#fb')).not.toBeEmpty()
    expect(await errorMessages(page)).toEqual([])
  })
})
