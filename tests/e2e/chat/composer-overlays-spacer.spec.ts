import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createSkillByApi, openGrantedMember } from '../helpers/skills'
import type { ComposerMetrics } from '../helpers/composer-metrics'
import {
  openChatCase as openCase,
  readComposerMetrics as readMetrics,
  settleLayout as settle,
} from '../helpers/composer-metrics'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ timeout: 90_000 })

const MOBILE_VIEWPORT = { width: 430, height: 932 }
const HEIGHT_TOLERANCE: number = 1
const TOP_ALIGNMENT_MAX: number = 160
const CONNECTOR_PROMPT: string = 'Ask Linear about the login bug.'

function buildConnector() {
  return {
    id: 'cnt-linear',
    slug: 'linear',
    title: 'Linear',
    host: 'mcp.linear.app',
    status: 'ready',
    enabled: true,
    toolMode: 'manual',
    authType: 'oauth',
    createdVia: 'manual',
    presetId: null,
    addedByApp: null,
    consent: { state: 'current', issuerHost: null, givenAt: null },
    note: null,
    tools: { total: 1, enabled: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastConnectedAt: null,
  }
}

async function mockLinearConnector(page: Page): Promise<void> {
  await page.route('**/api/v1/connectors', async (route: Route) => {
    await route.fulfill({ json: { connectors: [buildConnector()] } })
  })
  await page.route('**/api/v1/chats/test/connectors', async (route: Route) => {
    await route.fulfill({ json: { connectorIds: [] } })
  })
}

const ANSWER: string = 'This is a long response from the AI.'
const ANSWER_BODY: string = Array.from({ length: 24 }, (_item, index) => {
  return `${ANSWER} Paragraph ${index + 1} keeps the reply taller than the `
    + 'space above the composer, so the spacer takes the tall-pair branch.'
}).join('\n\n')

async function interceptShortAnswer(page: Page): Promise<void> {
  await page.route('**/api/v1/profiles/keys**', async (route: Route) => {
    await route.fulfill({
      json: { keys: [{ provider: 'google', hasKey: true }] },
    })
  })
  await page.route(/\/api\/v1\/chats\/test(\?|$)/, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()

      return
    }

    const chunks = [
      { type: 'start', messageId: 'overlay-spacer-answer' },
      { type: 'start-step' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: ANSWER_BODY },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish-step' },
      { type: 'finish' },
    ]

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
      body: [
        ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
        'data: [DONE]\n\n',
      ].join(''),
    })
  })
}

async function openMobileMember(
  browser: Parameters<typeof openGrantedMember>[0],
  prefix: string,
  flags: readonly string[],
): Promise<Page> {
  const page = await openGrantedMember(browser, prefix, flags)

  await page.setViewportSize(MOBILE_VIEWPORT)
  await interceptShortAnswer(page)

  return page
}

async function expectComposerHeightUnchanged(
  page: Page,
  baselineHeight: number,
): Promise<void> {
  await expect.poll(async () => {
    return Math.abs((await readMetrics(page)).composerHeight - baselineHeight)
  }).toBeLessThanOrEqual(HEIGHT_TOLERANCE)
}

async function sendAndWaitForReady(page: Page): Promise<void> {
  await page.getByTestId('send-message').click()
  await expect(
    page.locator('button[data-testid="stop-generation"]').first(),
  ).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('[data-role="assistant"]').last())
    .toContainText(ANSWER, {
      timeout: 30_000,
    })
  await settle(page)
}

async function sendFromFreshChat(
  page: Page,
  prompt: string,
): Promise<ComposerMetrics> {
  await openCase(page, '/chats/test?scenario=short&messages=20')
  await settle(page)
  await page.getByTestId('chat-input-textarea').fill(prompt)
  await sendAndWaitForReady(page)

  return readMetrics(page)
}

test('the connector suggestion does not change the composer height', async ({
  browser,
}) => {
  const page = await openMobileMember(browser, 'e2e-overlay-connector', [
    'connectors',
  ])

  await mockLinearConnector(page)
  await openCase(page, '/chats/test?scenario=short&messages=20')
  await settle(page)

  const baseline = await readMetrics(page)

  await page.getByTestId('chat-input-textarea').fill(CONNECTOR_PROMPT)
  await expect(page.getByTestId('connector-suggestion')).toBeVisible()
  await expectComposerHeightUnchanged(page, baseline.composerHeight)

  await page.getByTestId('chat-input-textarea').fill('')
  await expect(page.getByTestId('connector-suggestion')).toHaveCount(0)
  await expectComposerHeightUnchanged(page, baseline.composerHeight)
})

test('sending with the connector suggestion visible pins the message like a plain send', async ({
  browser,
}) => {
  const plainPage = await openMobileMember(browser, 'e2e-overlay-plain', [
    'connectors',
  ])

  await mockLinearConnector(plainPage)

  const plain = await sendFromFreshChat(plainPage, 'Say hello please.')

  const chipPage = await openMobileMember(browser, 'e2e-overlay-chip', [
    'connectors',
  ])

  await mockLinearConnector(chipPage)
  await openCase(chipPage, '/chats/test?scenario=short&messages=20')
  await settle(chipPage)
  await chipPage.getByTestId('chat-input-textarea').fill(CONNECTOR_PROMPT)
  await expect(chipPage.getByTestId('connector-suggestion')).toBeVisible()
  await sendAndWaitForReady(chipPage)
  await expect(chipPage.getByTestId('connector-suggestion')).toBeVisible()

  const withChip = await readMetrics(chipPage)

  await chipPage.getByTestId('connector-suggestion-dismiss').click()
  await expect(chipPage.getByTestId('connector-suggestion')).toHaveCount(0)
  await settle(chipPage)

  const afterDismiss = await readMetrics(chipPage)

  expect(withChip.lastUserTop).toBeLessThan(TOP_ALIGNMENT_MAX)
  expect(Math.abs(withChip.spacerHeight - plain.spacerHeight))
    .toBeLessThanOrEqual(HEIGHT_TOLERANCE)
  expect(Math.abs(withChip.lastUserTop - plain.lastUserTop))
    .toBeLessThanOrEqual(HEIGHT_TOLERANCE)
  expect(afterDismiss.composerHeight).toBe(withChip.composerHeight)
  expect(afterDismiss.spacerHeight).toBe(withChip.spacerHeight)
  expect(afterDismiss.lastUserTop).toBe(withChip.lastUserTop)
})

test('the pending approval chip stays hidden while the bubble is on screen and never changes the composer height', async ({
  browser,
}) => {
  const page = await openMobileMember(browser, 'e2e-overlay-approval', [
    'tool-approvals',
  ])

  await openCase(page, '/chats/test?scenario=tool-approval')
  await expect(page.getByTestId('tool-approval-bubble')).toBeVisible()
  await settle(page)
  await expect(page.getByTestId('tool-approval-chip')).toHaveCount(0)
  await expect(page.getByTestId('tool-approval-live-region'))
    .toHaveText('Action waiting for approval')

  const metrics = await readMetrics(page)
  const bubbleHeight = await page.evaluate(() => {
    const composer = document.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLElement

    return (composer.querySelector(':scope > .justify-center') as HTMLElement)
      .offsetHeight
  })

  expect(Math.abs(metrics.composerHeight - bubbleHeight))
    .toBeLessThanOrEqual(HEIGHT_TOLERANCE)
})

test('opening and closing the command picker does not change the composer height', async ({
  browser,
}) => {
  const page = await openMobileMember(browser, 'e2e-overlay-picker', [
    'skills',
    'skills.commands',
  ])

  await createSkillByApi(
    page,
    `e2e-overlay-skill-${Date.now()}`,
    'Turn raw notes into a summary',
    { command: 'meeting', mode: 'ask' },
  )
  await openCase(page, '/chats/test?scenario=short&messages=20')
  await settle(page)

  const baseline = await readMetrics(page)

  await page.getByTestId('chat-input-textarea').click()
  await page.keyboard.type('/mee')

  const picker = page.getByTestId('command-picker')

  await expect(picker).toBeVisible()
  await expectComposerHeightUnchanged(page, baseline.composerHeight)

  await page.keyboard.press('Escape')
  await page.getByTestId('chat-input-textarea').fill('')
  await expect(picker).toHaveCount(0)
  await expectComposerHeightUnchanged(page, baseline.composerHeight)
})
