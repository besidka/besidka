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

  const summary = page.locator('[data-testid="chat-messages-container"] summary')
    .first()

  if (!await stepTitle.first().isVisible()) {
    await summary.click()
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
