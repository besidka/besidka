import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const TEXTAREA = 'textarea[placeholder="Type your message here..."]'
const USER_BUBBLE = '[data-testid="chat-messages-container"] .chat-end '
  + '.js-chat-bubble'
const PASTED_HTML = '<div>Dobry wieczór,</div><div><br></div>'
  + '<div>Przesyłam stan liczników za wrzesień:</div>'
  + '<ul><li>Prąd: 3442 kWh (+134)</li>'
  + '<li>Woda zimna: 45.5 m³ (+2.5)</li></ul>'
  + '<div><br></div><div>Razem: <b>5458 zł</b></div>'
const PASTED_PLAIN = 'Dobry wieczór,\n\nPrzesyłam stan liczników za wrzesień:\n'
  + 'Prąd: 3442 kWh (+134)\nWoda zimna: 45.5 m³ (+2.5)\n\n'
  + 'Razem: 5458 zł'
const EXPECTED_MARKDOWN = 'Dobry wieczór,\n\n'
  + 'Przesyłam stan liczników za wrzesień:\n\n'
  + '- Prąd: 3442 kWh (+134)\n'
  + '- Woda zimna: 45.5 m³ (+2.5)\n\n'
  + 'Razem: **5458 zł**'

test.use({ viewport: { width: 1280, height: 800 } })

test.describe.configure({ timeout: 45_000 })

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 2,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])
})

async function openNewChat(page: Page): Promise<Locator> {
  await page.goto('/chats/new')
  await waitForHydration(page)

  const textarea = page.locator(TEXTAREA)

  await expect(textarea).toBeVisible()
  await textarea.focus()

  return textarea
}

test.describe('Chat input markdown', () => {
  test('renders user markdown without interpreting raw html', async ({
    page,
  }) => {
    await page.goto('/chats/test?scenario=markdown&messages=2')
    await waitForHydration(page)

    const bubble = page.locator(USER_BUBBLE).first()

    await expect(bubble).toBeVisible()
    await expect(bubble.locator('blockquote')).toHaveCount(1)
    await expect(bubble.locator('pre code')).toContainText('a && b < c')
    await expect(bubble.locator('pre code')).toContainText('<div>')
    await expect(bubble.locator('code', { hasText: '<span>' }).first())
      .toBeVisible()
    await expect(bubble.locator('strong', { hasText: 'Razem: 5458 zł' }))
      .toHaveCount(1)
    await expect(bubble.locator('ul > li')).toHaveCount(2)
    await expect(bubble.locator('img')).toHaveCount(0)
    await expect(bubble.locator('b')).toHaveCount(0)
    await expect(bubble.locator('iframe')).toHaveCount(0)
    await expect(bubble).toContainText('Vec<String>')
    await expect(bubble).toContainText('::iframe{src="https://example.com"}')
    await expect(bubble).toContainText('<img src=x')

    const xssFlag = await page.evaluate(() => {
      return (window as unknown as { __xss?: number }).__xss
    })

    expect(xssFlag).toBeUndefined()
  })

  test('converts pasted html to markdown and undoes in one step', async ({
    page,
  }) => {
    const textarea = await openNewChat(page)

    await textarea.evaluate((element, payload) => {
      const dataTransfer = new DataTransfer()

      dataTransfer.setData('text/html', payload.html)
      dataTransfer.setData('text/plain', payload.plain)
      element.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      }))
    }, { html: PASTED_HTML, plain: PASTED_PLAIN })

    await expect(textarea).toHaveValue(EXPECTED_MARKDOWN)

    await textarea.press('ControlOrMeta+z')

    const valueAfterUndo = await textarea.inputValue()

    test.info().annotations.push({
      type: 'undo-value-after-one-step',
      description: JSON.stringify(valueAfterUndo),
    })
    expect(valueAfterUndo).toBe('')
  })

  test('keeps enter inside an open code fence and continues lists on '
    + 'shift+enter', async ({ page }) => {
    const textarea = await openNewChat(page)

    await page.keyboard.type('```ts')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/chats\/new/)
    await expect(textarea).toHaveValue(/```ts\n/)

    await textarea.fill('')
    await page.keyboard.type('- item')
    await page.keyboard.press('Shift+Enter')

    await expect(textarea).toHaveValue('- item\n- ')
  })
})
