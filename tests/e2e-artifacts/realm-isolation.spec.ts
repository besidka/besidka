import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const FRAME_SELECTOR = '[data-testid="artifact-frame"]'
const REDECLARATION_MESSAGE = /already been declared/

function counterVersion(label: string): string {
  return `<!doctype html><html><body>
<p id="label">${label}</p>
<button id="up">Up</button>
<script>
  let count = 0
  const label = '${label}'
  class Counter {}
  document.getElementById('up').addEventListener('click', () => {
    count += 1
    document.getElementById('label').textContent = label + ':' + count
  })
</script>
</body></html>`
}

async function mountHarness(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
}

async function mountFreshFrame(page: Page) {
  await page.evaluate(() => {
    (window as any).harness.mount({})
  })
  await page.waitForFunction(() => {
    return (window as any).harness.state.ready === true
  })
}

async function sendHtml(page: Page, content: string) {
  await page.evaluate((payload) => {
    (window as any).harness.sendResult(payload)
  }, { kind: 'html', title: 'Counter', content })
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

test.describe('Artifact realm isolation', () => {
  test('a second version in the same frame redeclares top-level bindings', async ({ page, browserName }) => {
    await mountHarness(page)
    await mountFreshFrame(page)
    await sendHtml(page, counterVersion('v1'))

    const frame = page.frameLocator(FRAME_SELECTOR)

    await expect(frame.locator('#label')).toHaveText('v1')
    expect(await errorMessages(page)).toEqual([])

    await sendHtml(page, counterVersion('v2'))

    await expect.poll(() => errorMessages(page)).toHaveLength(1)

    const [message] = await errorMessages(page)

    if (browserName !== 'webkit') {
      expect(message).toMatch(REDECLARATION_MESSAGE)
    }
  })

  test('a fresh frame per version runs v1, v2 and v1 without errors', async ({ page }) => {
    await mountHarness(page)

    const frame = page.frameLocator(FRAME_SELECTOR)

    for (const label of ['v1', 'v2', 'v1']) {
      await mountFreshFrame(page)
      await sendHtml(page, counterVersion(label))
      await expect(frame.locator('#label')).toHaveText(label)
      await frame.locator('#up').click()
      await expect(frame.locator('#label')).toHaveText(`${label}:1`)
      expect(await errorMessages(page)).toEqual([])
    }
  })

  test('a theme change keeps the same realm and does not reload the frame', async ({ page }) => {
    await mountHarness(page)
    await mountFreshFrame(page)
    await sendHtml(page, counterVersion('v1'))

    const frame = page.frameLocator(FRAME_SELECTOR)

    await frame.locator('#up').click()
    await page.evaluate(() => {
      (window as any).harness.setTheme('dark')
    })
    await frame.locator('#up').click()
    await expect(frame.locator('#label')).toHaveText('v1:2')

    const loads = await page.evaluate(() => {
      return (window as any).harness.state.loads
    })

    expect(loads).toBe(1)
    expect(await errorMessages(page)).toEqual([])
  })
})
