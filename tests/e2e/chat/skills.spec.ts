import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'
import { createSkillByApi, openGrantedMember } from '../helpers/skills'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ mode: 'serial', timeout: 90_000 })

const STEP_CARD_TIMEOUT = 30_000

test('a member attaches a skill from + Add skill, reads it and opens it in the editor', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-chat-skills')
  const skillName = `e2e-voice-${Date.now()}`

  await createSkillByApi(page, skillName, 'Write in my own voice')
  await page.goto('/chats/new')
  await waitForHydration(page)

  await page.getByTestId('chat-input-tools-trigger').click()
  await expect(page.getByTestId('tools-action-skills')).toContainText('Add skill')
  await page.getByTestId('tools-action-skills').click()

  const picker = page.getByTestId('skill-picker-dialog')
  const row = picker.getByTestId(`skill-picker-item-${skillName}`)

  await expect(picker).toBeVisible()
  await expect(row).toBeVisible()
  await expect(row).toContainText('Write in my own voice')
  await expect(picker.getByTestId('skill-picker-manage')).toBeVisible()
  await row.click()

  const tile = page.getByTestId('chat-input-tile-skill')

  await expect(tile).toBeVisible()
  await expect(tile).toContainText('Skill')
  await expect(tile).toContainText(skillName)

  await page.getByTestId('chat-input-tile-skill-remove').click()
  await expect(tile).toHaveCount(0)

  await page.getByTestId('chat-input-tools-trigger').click()
  await page.getByTestId('tools-action-skills').click()
  await page.getByTestId(`skill-picker-item-${skillName}`).click()
  await page.getByTestId('chat-input-tile-skill-body').click()

  const preview = page.locator('dialog.js-skill-preview')

  await expect(preview).toBeVisible()
  await expect(preview.getByTestId('skill-preview-name')).toHaveText(skillName)
  await expect(preview.getByTestId('skill-preview-mode')).toHaveText('Auto')
  await expect(preview.getByTestId('skill-preview-text'))
    .toContainText(`name: ${skillName}`)

  await preview.getByTestId('skill-preview-edit').click()

  await expect(page).toHaveURL(/\/chats\/skills$/)
  await expect(page.locator('dialog.js-skill-edit-modal')).toBeVisible()
})

test('a member runs a skill with /command: pick, highlight, tile, send without the token, then the answer', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-skill-command')
  const skillName = `e2e-notes-${Date.now()}`
  const skillId = await createSkillByApi(
    page,
    skillName,
    'Turn raw notes into a summary',
    { command: 'meeting', mode: 'ask' },
  )
  const sentBodies: Array<{ parts: Array<Record<string, unknown>> }> = []

  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await route.fulfill({
      json: { keys: [{ provider: 'google', hasKey: true }] },
    })
  })
  await page.route('**/api/v1/chats/new', async (route) => {
    sentBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 500,
      json: { message: 'Scripted failure' },
    })
  })

  await page.goto('/chats/new')
  await waitForHydration(page)

  const textarea = page.getByTestId('chat-input-textarea')

  await textarea.click()
  await page.keyboard.type('/mee')

  const picker = page.getByTestId('command-picker')

  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('command-picker-item-meeting'))
    .toContainText(skillName)
  await expect(picker.getByTestId('command-picker-item-meeting'))
    .toContainText('Only when I ask')

  await page.keyboard.press('Enter')

  await expect(picker).toHaveCount(0)
  await expect(textarea).toHaveValue('/meeting ')
  await expect(page).toHaveURL(/\/chats\/new/)
  await expect(page.getByTestId('command-mirror-token'))
    .toHaveText('/meeting')
  await expect(page.getByTestId('chat-input-tile-skill'))
    .toContainText(skillName)

  await page.keyboard.type('standup notes')
  await page.getByTestId('send-message').click()

  await expect.poll(() => sentBodies.length).toBe(1)

  const parts = sentBodies[0]!.parts

  expect(parts.find(part => part.type === 'text')).toMatchObject({
    text: 'standup notes',
  })
  expect(parts.find(part => part.type === 'data-skill-invocation'))
    .toMatchObject({ data: { skillId, name: skillName } })
  expect(JSON.stringify(parts)).not.toContain('/meeting')

  await expect(textarea).toHaveValue('standup notes')
  await expect(page.getByTestId('chat-input-tile-skill'))
    .toContainText(skillName)

  await page.goto(
    `/chats/test?scenario=skill&skillId=${skillId}&skillName=${skillName}`
    + '&regenerate',
  )
  await waitForHydration(page)
  await expect(page.getByTestId('reasoning-skill-step').first())
    .toBeAttached({ timeout: STEP_CARD_TIMEOUT })

  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('reasoning-skill-step').first())
    .toBeAttached({ timeout: STEP_CARD_TIMEOUT })
})

test('Backspace after a typed command removes the name and reopens the picker', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-skill-backspace')
  const skillName = `e2e-back-${Date.now()}`

  await createSkillByApi(page, skillName, 'Any task', {
    command: 'again',
    mode: 'ask',
  })
  await page.goto('/chats/new')
  await waitForHydration(page)

  const textarea = page.getByTestId('chat-input-textarea')

  await textarea.click()
  await page.keyboard.type('/again')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')

  await expect(textarea).toHaveValue('/')
  await expect(page.getByTestId('command-picker')).toBeVisible()
  await expect(page.getByTestId('chat-input-tile-skill')).toHaveCount(0)
  await expect(page.getByTestId('command-mirror-token')).toHaveCount(0)
})

test('an answer shows the used skill as a reasoning step that opens the preview', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-skill-step')
  const skillName = `e2e-step-${Date.now()}`
  const skillId = await createSkillByApi(page, skillName, 'Write in my voice')

  await page.goto(
    `/chats/test?scenario=skill&skillId=${skillId}&skillName=${skillName}`
    + '&regenerate',
  )
  await waitForHydration(page)

  const stepTitle = page.getByTestId('reasoning-skill-step-title')

  await expect(page.getByTestId('skill-step')).toHaveCount(0)
  await expect(page.getByTestId('reasoning-skill-step').first())
    .toBeAttached({ timeout: STEP_CARD_TIMEOUT })

  await expect(page.getByText('This is a short response'))
    .toBeVisible({ timeout: STEP_CARD_TIMEOUT })

  const reasoningBox = page
    .locator('[data-testid="chat-messages-container"] details')
    .first()

  if (!await reasoningBox.evaluate(element => element.open)) {
    await reasoningBox.locator('summary').first().click()
  }

  await expect(stepTitle.first())
    .toContainText(`Applied skill · ${skillName}`, {
      timeout: STEP_CARD_TIMEOUT,
    })
  await page.getByTestId('reasoning-skill-step-open').first().click()

  const preview = page.locator('dialog.js-skill-preview')

  await expect(preview).toBeVisible()
  await expect(preview.getByTestId('skill-preview-name')).toHaveText(skillName)
})
