import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  TEST_CODE_STREAM_LINES,
} from '../../../server/utils/chats/test/code-fixture'
import { waitForHydration } from '../helpers/auth'

test.describe.configure({
  timeout: 90_000,
})

const BLOCK_INDEX = {
  shortTypeScript: 0,
  go: 1,
  rust: 2,
  diff: 3,
  unknown: 4,
  longTypeScript: 5,
}

function getCodeStream(page: Page, index: number): Locator {
  return page
    .locator('[data-role="assistant"] [data-testid="code-stream"]')
    .nth(index)
}

async function getDistinctColours(stream: Locator): Promise<number> {
  return stream.evaluate((element) => {
    const colours = new Set(
      [...element.querySelectorAll<HTMLElement>('span[style]')]
        .map((span) => {
          return span.style.color
        })
        .filter(Boolean),
    )

    return colours.size
  })
}

test.describe('Code highlighting', () => {
  test('colours persisted blocks per language and leaves unknown ones '
    + 'plain', async ({ page }) => {
    await page.goto('/chats/test?scenario=code&messages=2')
    await waitForHydration(page)

    for (const index of Object.values(BLOCK_INDEX)) {
      await expect(getCodeStream(page, index))
        .toHaveAttribute('data-highlighted', 'true', { timeout: 15_000 })
    }

    for (const index of [
      BLOCK_INDEX.shortTypeScript,
      BLOCK_INDEX.go,
      BLOCK_INDEX.rust,
      BLOCK_INDEX.diff,
      BLOCK_INDEX.longTypeScript,
    ]) {
      expect(await getDistinctColours(getCodeStream(page, index)))
        .toBeGreaterThan(2)
    }

    expect(await getDistinctColours(getCodeStream(page, BLOCK_INDEX.unknown)))
      .toBe(0)
  })

  test('colours a long block while it streams', async ({ page }) => {
    await page.goto('/chats/test?scenario=code&messages=1&regenerate')
    await waitForHydration(page)

    const stream = getCodeStream(page, 0)

    await expect(stream).toHaveAttribute('data-highlighted', 'true', {
      timeout: 30_000,
    })

    const linesWhileStreaming = (await stream.locator('code').textContent())
      ?.split('\n').length ?? 0

    expect(linesWhileStreaming).toBeLessThan(TEST_CODE_STREAM_LINES)
    expect(await getDistinctColours(stream)).toBeGreaterThan(2)

    await expect(
      page.locator('button[data-testid="stop-generation"]').first(),
    ).toBeHidden({ timeout: 60_000 })
    await expect.poll(async () => {
      const text = await stream.locator('code').textContent()

      return text?.split('\n').length
    }, { timeout: 15_000 }).toBe(TEST_CODE_STREAM_LINES)

    expect(await getDistinctColours(stream)).toBeGreaterThan(2)
  })
})
