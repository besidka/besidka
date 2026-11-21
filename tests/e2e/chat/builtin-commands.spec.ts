import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'
import { createSkillByApi, openGrantedMember } from '../helpers/skills'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ mode: 'serial', timeout: 90_000 })

const REPLY_TIMEOUT = 30_000

test('a member without a key runs /cost and /stats from the picker, with no model', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-builtin-commands')
  const providerRequests: string[] = []

  page.on('request', (request) => {
    if (/api\.(openai|anthropic)\.com|generativelanguage/.test(request.url())) {
      providerRequests.push(request.url())
    }
  })

  await page.goto('/chats/new')
  await waitForHydration(page)

  const textarea = page.getByTestId('chat-input-textarea')

  await textarea.click()
  await page.keyboard.type('/co')

  const picker = page.getByTestId('command-picker')
  const costRow = picker.getByTestId('command-picker-item-cost')

  await expect(picker).toBeVisible()
  await expect(costRow).toContainText('Chat cost')
  await expect(picker.getByTestId('command-picker-builtin-cost'))
    .toHaveText('Built-in')

  await page.keyboard.press('Enter')

  await expect(textarea).toHaveValue('/cost ')
  await expect(page.getByTestId('command-mirror-token')).toHaveText('/cost')

  await page.getByTestId('send-message').click()

  await expect(page).toHaveURL(/\/chats\/[0-9A-Z]{26}$/)

  const messages = page.getByTestId('chat-messages-container')

  await expect(messages.getByTestId('builtin-command-chip'))
    .toContainText('/cost')
  await expect(messages).toContainText('Chat cost (estimated)', {
    timeout: REPLY_TIMEOUT,
  })
  await expect(messages).toContainText('The provider\'s bill is authoritative.')

  await textarea.click()
  await page.keyboard.type('/stats 7d')
  await expect(page.getByTestId('command-mirror-token')).toHaveText('/stats')
  await page.getByTestId('send-message').click()

  await expect(messages).toContainText('Usage stats, last 7 days', {
    timeout: REPLY_TIMEOUT,
  })
  await expect(messages).toContainText('Chat replies only, days in UTC.')

  await page.reload()
  await waitForHydration(page)

  await expect(messages).toContainText('Usage stats, last 7 days')
  await expect(messages.getByTestId('builtin-command-chip')).toHaveCount(2)
  expect(providerRequests).toEqual([])
})

test('a skill cannot take a built-in or a used command', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-command-unique')
  const firstName = `e2e-first-${Date.now()}`

  await createSkillByApi(page, firstName, 'First skill', {
    command: 'review',
    mode: 'ask',
  })

  const duplicate = await page.request.post('/api/v1/skills', {
    data: {
      kind: 'blank',
      name: `e2e-second-${Date.now()}`,
      mode: 'ask',
      command: '/Review',
    },
  })

  expect(duplicate.status()).toBe(409)
  expect((await duplicate.json()).message)
    .toBe(`The command /review is already used by the skill ${firstName}`)

  const reserved = await page.request.post('/api/v1/skills', {
    data: {
      kind: 'blank',
      name: `e2e-third-${Date.now()}`,
      mode: 'ask',
      command: 'debug',
    },
  })

  expect(reserved.status()).toBe(400)
  expect((await reserved.json()).message).toBe('/debug is reserved by Besidka')
})

test('the Skills page lists the built-in commands, read only, below the user\'s skills', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-builtin-page')
  const skillName = `e2e-own-${Date.now()}`

  await page.goto('/chats/skills')
  await waitForHydration(page)

  const builtin = page.getByTestId('skills-builtin')

  await expect(builtin.getByRole('heading', { name: 'Built-in' }))
    .toBeVisible()
  await expect(page.getByTestId('skills-empty')).toBeVisible()
  await expect(page.getByTestId('skill-builtin-row')).toHaveCount(3)
  await expect(page.getByTestId('skill-builtin-command-stats'))
    .toHaveText('/stats [7d|30d|all]')
  await expect(page.getByTestId('skill-builtin-howto-cost'))
    .toContainText('type /cost in a chat')
  await expect(builtin.locator('select, details')).toHaveCount(0)

  const builtinBox = await builtin.boundingBox()
  const emptyBox = await page.getByTestId('skills-empty').boundingBox()

  expect(builtinBox!.y).toBeLessThan(emptyBox!.y)

  await createSkillByApi(page, skillName, 'My own skill')
  await page.reload()
  await waitForHydration(page)

  const listBox = await page.getByTestId('skills-list').boundingBox()
  const movedBox = await page.getByTestId('skills-builtin').boundingBox()

  expect(listBox!.y).toBeLessThan(movedBox!.y)

  await page.setViewportSize({ width: 390, height: 844 })

  const row = page.locator('[data-testid="skill-builtin-row"][data-command="stats"]')
  const rowBox = await row.boundingBox()

  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(390)
  await expect(page.getByTestId('skill-builtin-copy-stats')).toBeVisible()
})
