import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'
import { openGrantedMember } from '../helpers/skills'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ mode: 'serial', timeout: 90_000 })

const PROMPT = 'File a Linear issue for the login bug and remember that I '
  + 'use Safari.'
const STEP = 'reasoning-approval-step'

function streamBody(chunks: Record<string, unknown>[]): string {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ].join('')
}

async function fulfillStream(route: Route, chunks: Record<string, unknown>[]) {
  await route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
    body: streamBody(chunks),
  })
}

async function fulfillError(
  route: Route,
  status: number,
  body: Record<string, unknown>,
) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function interceptAnswers(
  page: Page,
  respond: (route: Route, body: Record<string, unknown>) => Promise<void>,
): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = []

  await page.route(/\/api\/v1\/chats\/test(\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()

      return
    }

    const body = route.request().postDataJSON() as Record<string, unknown>

    bodies.push(body)
    await respond(route, body)
  })

  return bodies
}

async function openScenario(page: Page, scenario: string) {
  await page.goto(`/chats/test?scenario=${scenario}`)
  await waitForHydration(page)
  await expect(page.getByTestId(STEP).first()).toBeVisible()
}

test('an allowed call resumes the same reply with the answer', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-tool-approval', [
    'tool-approvals',
  ])
  const bodies = await interceptAnswers(page, async (route) => {
    await fulfillStream(route, [
      { type: 'start', messageId: 'test-chat-tool-approval-message-2' },
      { type: 'start-step' },
      {
        type: 'tool-output-available',
        toolCallId: 'test-approval-call-1',
        output: 'Created WEB-42',
        dynamic: true,
      },
      { type: 'finish-step' },
      { type: 'start-step' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Filed WEB-42 for you.' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish-step' },
      { type: 'finish' },
    ])
  })

  await openScenario(page, 'tool-approval')

  const step = page.getByTestId(STEP)

  await expect(step).toHaveAttribute('data-state', 'pending')
  await expect(page.getByTestId('reasoning-approval-step-title'))
    .toHaveText('linear wants to run create_issue')
  await expect(page.getByTestId('reasoning-approval-step-reason'))
    .toHaveText('Runs only after you allow it')
  await expect(page.getByTestId('reasoning-approval-step-allow-chat'))
    .toBeVisible()
  await expect(page.getByTestId('reasoning-approval-step-allow-always'))
    .toBeVisible()
  await expect(page.getByTestId('tool-approval-chip'))
    .toHaveText('1 action waiting for approval')
  await expect(page.getByTestId('tool-approval-live-region'))
    .toHaveText('Action waiting for approval')

  await page.getByTestId('tool-approval-chip').click()
  await expect(step).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByText('Filed WEB-42 for you.')).toBeVisible()
  await expect(page.getByTestId(STEP)).toHaveCount(0)
  await expect(page.getByTestId('reasoning-approval-outcome'))
    .toContainText('Allowed')
  await expect(page.getByTestId('tool-approval-chip')).toHaveCount(0)
  expect(bodies).toEqual([{
    approval: {
      messageId: 'test-chat-tool-approval-message-2',
      responses: [{
        approvalId: 'test-approval-0001',
        approved: true,
        remember: 'once',
      }],
    },
  }])
})

test('two calls send one request once both are answered', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-tool-approvals', [
    'tool-approvals',
  ])
  const bodies = await interceptAnswers(page, async (route) => {
    await fulfillStream(route, [
      { type: 'start', messageId: 'test-chat-tool-approvals-message-2' },
      { type: 'start-step' },
      {
        type: 'tool-output-denied',
        toolCallId: 'test-approval-call-1',
      },
      {
        type: 'tool-output-available',
        toolCallId: 'test-approval-call-2',
        output: { saved: true },
      },
      { type: 'finish-step' },
      { type: 'finish' },
    ])
  })

  await openScenario(page, 'tool-approvals')

  const steps = page.getByTestId(STEP)

  await expect(steps).toHaveCount(2)
  await expect(page.getByTestId('tool-approval-chip'))
    .toHaveText('2 actions waiting for approval')
  await expect(steps.nth(1).getByTestId('reasoning-approval-step-title'))
    .toHaveText('Save to memory')
  await expect(steps.nth(1).getByTestId('reasoning-approval-step-reason'))
    .toHaveText('Because this message read content from the web')

  await steps.nth(0).getByTestId('reasoning-approval-step-deny').click()

  await expect(steps.nth(0)).toHaveAttribute('data-state', 'answered')
  await expect(steps.nth(1).getByTestId('reasoning-approval-step-progress'))
    .toHaveText('1 of 2 answered')
  expect(bodies).toHaveLength(0)

  await steps.nth(1).getByTestId('reasoning-approval-step-allow-once').click()

  await expect(page.getByTestId(STEP)).toHaveCount(1)
  await expect(page.getByTestId(STEP)).toHaveAttribute('data-state', 'denied')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toEqual({
    approval: {
      messageId: 'test-chat-tool-approvals-message-2',
      responses: [
        { approvalId: 'test-approval-0001', approved: false, remember: 'once' },
        { approvalId: 'test-approval-0002', approved: true, remember: 'once' },
      ],
    },
  })
})

test('an expired approval offers Ask again with the original prompt', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-tool-approval-expired', [
    'tool-approvals',
  ])

  await interceptAnswers(page, async (route) => {
    await fulfillError(route, 409, {
      statusCode: 409,
      message: 'This approval expired',
      data: { code: 'TOOL_APPROVAL_EXPIRED', fix: 'Ask again' },
    })
  })
  await openScenario(page, 'tool-approval')

  await page.getByTestId('reasoning-approval-step-allow-once').click()

  await expect(page.getByTestId(STEP)).toHaveAttribute('data-state', 'expired')
  await expect(page.getByTestId('reasoning-approval-step-failure'))
    .toContainText('This approval expired.')
  await expect(page.locator('.alert-error')).toHaveCount(0)

  await page.getByTestId('reasoning-approval-step-ask-again').click()

  await expect(page.getByTestId('chat-input-textarea')).toHaveValue(PROMPT)
})

test('a rate limit brings the buttons back with a toast', async ({ browser }) => {
  const page = await openGrantedMember(browser, 'e2e-tool-approval-limit', [
    'tool-approvals',
  ])

  await interceptAnswers(page, async (route) => {
    await fulfillError(route, 429, {
      statusCode: 429,
      message: 'Too many approval answers',
      data: { why: 'An account can answer at most 30 approvals a minute' },
    })
  })
  await openScenario(page, 'tool-approval')

  await page.getByTestId('reasoning-approval-step-allow-once').click()

  await expect(page.getByText('Too many approval answers')).toBeVisible()
  await expect(page.getByTestId(STEP)).toHaveAttribute('data-state', 'pending')
  await expect(page.getByTestId('reasoning-approval-step-allow-once'))
    .toBeEnabled()
})
