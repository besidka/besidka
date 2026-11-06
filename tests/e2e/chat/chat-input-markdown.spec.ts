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

const LONG_PASTE = Array.from({ length: 45 }, (_line, index) => {
  return `Line ${index + 1} of the pasted report`
}).join('\n')

async function pastePlainText(textarea: Locator, text: string) {
  await textarea.evaluate((element, plain) => {
    const dataTransfer = new DataTransfer()

    dataTransfer.setData('text/plain', plain)
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    }))
  }, text)
}

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

  test('keeps a long paste as a chip, edits it and appends it on send',
    async ({ page }) => {
      const fileRequests: string[] = []
      const sentBodies: { parts: { type: string, text?: string }[] }[] = []

      page.on('request', (request) => {
        if (request.url().includes('/api/v1/files')) {
          fileRequests.push(request.url())
        }
      })

      await page.route('**/api/v1/profiles/keys**', async (route) => {
        await route.fulfill({
          json: { keys: [{ provider: 'google', hasKey: true }] },
        })
      })

      await page.route('**/api/v1/chats/new', async (route) => {
        sentBodies.push(route.request().postDataJSON())
        await route.fulfill({
          status: 503,
          json: { message: 'Stubbed send failure' },
        })
      })

      const textarea = await openNewChat(page)

      await pastePlainText(textarea, LONG_PASTE)

      const chip = page.locator('[data-testid="pasted-text-item"]')

      await expect(chip).toHaveCount(1)
      await expect(chip).toContainText('Line 1 of the pasted report')
      await expect(chip).toContainText('45 lines')
      await expect(textarea).toHaveValue('')

      await chip.locator('[data-testid="files-preview-text-open"]').click()

      const modal = page.locator('[data-testid="text-file-modal"]')
      const modalTextarea = modal
        .locator('[data-testid="text-file-modal-textarea"]')

      await expect(modal).toBeVisible()
      await expect(modalTextarea).toHaveValue(LONG_PASTE)

      await modalTextarea.fill(`${LONG_PASTE}\nEdited ending`)
      await modal.locator('[data-testid="text-file-modal-save"]').click()

      await expect(modal).toBeHidden()
      await expect(chip).toContainText('46 lines')

      await textarea.fill('Summarize this report:')
      await page.locator('[data-testid="send-message"]').click()

      await expect.poll(() => sentBodies.length).toBe(1)

      const expectedText = 'Summarize this report:\n\n'
        + `${LONG_PASTE}\nEdited ending`

      expect(sentBodies[0]!.parts).toEqual([
        { type: 'text', text: expectedText },
      ])
      await expect(textarea).toHaveValue(expectedText)
      await expect(chip).toHaveCount(0)
      expect(fileRequests).toEqual([])
    })

  test('moves a pasted chip into the textarea with Insert as text',
    async ({ page }) => {
      const textarea = await openNewChat(page)

      await textarea.fill('Before ')
      await pastePlainText(textarea, LONG_PASTE)

      const chip = page.locator('[data-testid="pasted-text-item"]')

      await chip.locator('[data-testid="files-preview-text-open"]').click()
      await page.locator('[data-testid="text-file-modal-insert"]').click()

      await expect(chip).toHaveCount(0)
      await expect(textarea).toHaveValue(`Before ${LONG_PASTE}`)
      await expect(textarea).toBeFocused()

      const caretOffset = await textarea.evaluate((element) => {
        return (element as HTMLTextAreaElement).selectionStart
      })

      expect(caretOffset).toBe(`Before ${LONG_PASTE}`.length)

      await page.keyboard.press('ControlOrMeta+z')

      await expect(textarea).toHaveValue('Before ')
    })

  test('asks before discarding unsaved edits of a pasted chip',
    async ({ page }) => {
      const textarea = await openNewChat(page)

      await pastePlainText(textarea, LONG_PASTE)

      const chip = page.locator('[data-testid="pasted-text-item"]')
      const modal = page.locator('[data-testid="text-file-modal"]')
      const modalTextarea = modal
        .locator('[data-testid="text-file-modal-textarea"]')

      await chip.locator('[data-testid="files-preview-text-open"]').click()
      await expect(modal).toBeVisible()
      await modal.locator('[data-testid="text-file-modal-cancel"]').click()
      await expect(modal).toBeHidden()

      await chip.locator('[data-testid="files-preview-text-open"]').click()
      await modalTextarea.fill('changed')
      await modal.locator('[data-testid="text-file-modal-cancel"]').click()

      await expect(page.locator('[data-testid="confirmation-decline"]'))
        .toBeVisible()
      await page.locator('[data-testid="confirmation-decline"]').click()
      await expect(modal).toBeVisible()
      await expect(modalTextarea).toHaveValue('changed')

      await modal.locator('[data-testid="text-file-modal-cancel"]').click()
      await page.locator('[data-testid="confirmation-action-0"]').click()
      await expect(modal).toBeHidden()
      await expect(chip).toContainText('45 lines')
    })

  test('keeps a pasted chip when moving to another chat page',
    async ({ page }) => {
      const textarea = await openNewChat(page)

      await pastePlainText(textarea, LONG_PASTE)
      await expect(page.locator('[data-testid="pasted-text-item"]'))
        .toHaveCount(1)

      await page.evaluate(() => {
        const nuxtApp = (window as unknown as {
          useNuxtApp: () => { $router: { push: (to: string) => void } }
        }).useNuxtApp()

        nuxtApp.$router.push('/chats/test?scenario=markdown&messages=2')
      })
      await expect(page).toHaveURL(/\/chats\/test/)
      await waitForHydration(page)

      await expect(page.locator('[data-testid="pasted-text-item"]'))
        .toHaveCount(1)
    })
})
