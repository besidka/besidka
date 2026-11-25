import type { Browser, Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { openGrantedMember } from '../helpers/skills'
import {
  openChatCase,
  readComposerMetrics,
  settleLayout,
} from '../helpers/composer-metrics'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ timeout: 120_000 })

const CASE_URL = '/chats/test?scenario=short&messages=20'
const PROMPT = 'Change the rail on the canvas.'
const MESSAGE_ID = 'approval-scroll-answer'
const CALL_ID = 'approval-scroll-call-1'
const APPROVAL_ID = 'approval-scroll-0001'
const TOOL_NAME = 'mcp__doop__edit_frame_html'
const BEFORE_END = 'Now I will edit the frame.'
const AFTER_END = 'The new rail is on the canvas.'
const LAYOUT_TOLERANCE = 2
const TOP_ALIGNMENT_MAX = 160
const CONTINUATION_DELAY_MS = 1_500
const TEXT_WAIT_MAX_MS = 15_000
const SAMPLE_INTERVAL_MS = 40

const VIEWPORTS = [
  { name: 'mobile', size: { width: 390, height: 844 } },
  { name: 'desktop', size: { width: 1280, height: 800 } },
] as const

function paragraphs(sentence: string, count: number, end: string): string {
  return [
    ...Array.from({ length: count }, (_item, index) => {
      return `${sentence} Paragraph ${index + 1} keeps the reply taller `
        + 'than the space above the composer.'
    }),
    end,
  ].join('\n\n')
}

const BEFORE_TEXT = paragraphs('First I connect to the canvas.', 10, BEFORE_END)
const AFTER_TEXT = paragraphs('The change is done.', 10, AFTER_END)
const SHORT_REASONING = 'The rail edit needs the canvas tool.'
const SHORT_AFTER_END = 'Done, the rail is updated.'

function textChunks(id: string, text: string) {
  return [
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
  ]
}

const TOOL_INPUT_CHUNK = {
  type: 'tool-input-available',
  toolCallId: CALL_ID,
  toolName: TOOL_NAME,
  input: { frame: 'rail' },
  dynamic: true,
}

const SHORT_REASONING_CHUNKS = [
  { type: 'reasoning-start', id: 'reasoning-1' },
  { type: 'reasoning-delta', id: 'reasoning-1', delta: SHORT_REASONING },
  { type: 'reasoning-end', id: 'reasoning-1' },
]

const TOOL_OUTPUT_CHUNK = {
  type: 'tool-output-available',
  toolCallId: CALL_ID,
  output: 'Frame updated',
  dynamic: true,
}

/**
 * The first half of a reply that pauses for an approval: text, the call,
 * its approval request and the server's approval data part. The short
 * variant has only a reasoning row before the call.
 */
function pausedChunks(variant: 'tall' | 'short' = 'tall') {
  return [
    { type: 'start', messageId: MESSAGE_ID },
    { type: 'start-step' },
    ...(variant === 'short'
      ? SHORT_REASONING_CHUNKS
      : textChunks('text-1', BEFORE_TEXT)),
    TOOL_INPUT_CHUNK,
    {
      type: 'tool-approval-request',
      approvalId: APPROVAL_ID,
      toolCallId: CALL_ID,
    },
    {
      type: 'data-tool-approval',
      id: CALL_ID,
      data: {
        approvalId: APPROVAL_ID,
        toolCallId: CALL_ID,
        toolName: TOOL_NAME,
        reason: 'always-ask',
        summary: `doop wants to run ${TOOL_NAME}`,
        rememberOptions: ['once', 'chat', 'always'],
      },
    },
    { type: 'finish-step' },
    { type: 'finish' },
  ]
}

function continuationChunks() {
  return [
    { type: 'start', messageId: MESSAGE_ID },
    { type: 'start-step' },
    TOOL_OUTPUT_CHUNK,
    { type: 'finish-step' },
    { type: 'start-step' },
    ...textChunks('text-2', AFTER_TEXT),
    { type: 'finish-step' },
    { type: 'finish' },
  ]
}

/**
 * The same final reply, sent in one go without an approval.
 */
function plainChunks(variant: 'tall' | 'short' = 'tall') {
  return [
    { type: 'start', messageId: MESSAGE_ID },
    { type: 'start-step' },
    ...(variant === 'short'
      ? SHORT_REASONING_CHUNKS
      : textChunks('text-1', BEFORE_TEXT)),
    TOOL_INPUT_CHUNK,
    TOOL_OUTPUT_CHUNK,
    { type: 'finish-step' },
    { type: 'start-step' },
    ...textChunks(
      'text-2',
      variant === 'short' ? SHORT_AFTER_END : AFTER_TEXT,
    ),
    { type: 'finish-step' },
    { type: 'finish' },
  ]
}

async function fulfillStream(route: Route, chunks: unknown[]) {
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
}

/**
 * `route.fulfill()` sends a whole body at once, so a continuation whose text
 * comes after its tool output is streamed from the page instead: the tool
 * output goes out first and the text after a delay, which is what happens
 * when a server runs a slow tool before the model answers.
 */
async function streamContinuationFromPage(
  page: Page,
  finalText: string = AFTER_TEXT,
) {
  await page.addInitScript((stream) => {
    const originalFetch = window.fetch.bind(window)
    const encoder = new TextEncoder()

    function toEvent(chunk: unknown) {
      return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
    }

    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      )
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      const isApprovalAnswer = init?.method === 'POST'
        && url.pathname === '/api/v1/chats/test'
        && !!body?.approval

      if (!isApprovalAnswer) {
        return originalFetch(input, init)
      }

      const eventStream = new ReadableStream({
        async start(controller) {
          for (const chunk of stream.toolOutputChunks) {
            controller.enqueue(toEvent(chunk))
          }

          await new Promise((resolve) => {
            setTimeout(resolve, stream.delayMs)
          })

          for (const chunk of stream.textChunks) {
            controller.enqueue(toEvent(chunk))
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })

      return new Response(eventStream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      })
    }
  }, {
    delayMs: CONTINUATION_DELAY_MS,
    toolOutputChunks: [
      { type: 'start', messageId: MESSAGE_ID },
      { type: 'start-step' },
      TOOL_OUTPUT_CHUNK,
      { type: 'finish-step' },
      { type: 'start-step' },
    ],
    textChunks: [
      ...textChunks('text-2', finalText),
      { type: 'finish-step' },
      { type: 'finish' },
    ],
  })
}

async function openMember(
  browser: Browser,
  prefix: string,
  size: { width: number, height: number },
  mode: 'approval' | 'plain' | 'delayed-text' | 'short-delayed' | 'short-plain',
): Promise<Page> {
  const page = await openGrantedMember(browser, prefix, ['tool-approvals'])
  const variant = mode.startsWith('short') ? 'short' : 'tall'

  if (mode === 'delayed-text') {
    await streamContinuationFromPage(page)
  }

  if (mode === 'short-delayed') {
    await streamContinuationFromPage(page, SHORT_AFTER_END)
  }

  await page.setViewportSize(size)
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

    if (mode === 'plain' || mode === 'short-plain') {
      await fulfillStream(route, plainChunks(variant))

      return
    }

    const body = route.request().postDataJSON() as Record<string, unknown>

    if (!body.approval) {
      await fulfillStream(route, pausedChunks(variant))

      return
    }

    await new Promise((resolve) => {
      setTimeout(resolve, CONTINUATION_DELAY_MS)
    })
    await fulfillStream(route, continuationChunks())
  })

  return page
}

async function send(page: Page) {
  await page.getByTestId('chat-input-textarea').fill(PROMPT)
  await page.getByTestId('send-message').click()
}

async function waitUntilReady(page: Page, text: string) {
  await expect(
    page.locator('button[data-testid="stop-generation"]').first(),
  ).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('[data-role="assistant"]').last())
    .toContainText(text, { timeout: 30_000 })
  await settleLayout(page)
}

/**
 * How far the bubble's bottom sits above the top of the composer, and how
 * far its top sits below the top of the scroll container (both must be
 * zero or more for the whole bubble to show).
 */
async function readBubbleClearance(page: Page) {
  return page.evaluate(() => {
    const bubble = document.querySelector(
      '[data-testid="tool-approval-bubble"]',
    ) as HTMLElement | null
    const composer = document.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLElement
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement

    if (!bubble) {
      return { below: -1, above: -1 }
    }

    const bubbleRect = bubble.getBoundingClientRect()

    return {
      below: composer.getBoundingClientRect().top - bubbleRect.bottom,
      above: bubbleRect.top
        - messagesRoot.parentElement!.getBoundingClientRect().top,
    }
  })
}

interface LayoutSample {
  userTop: number
  scrollTop: number
  hasBubble: boolean
  hasText: boolean
}

/**
 * Reads the pinned user message and the scroll position on every animation
 * frame, before the frame is laid out again, so a layout that the browser
 * clamps and the app only corrects afterwards is recorded too.
 */
async function startLayoutSampler(page: Page, finalText: string) {
  await page.evaluate((text) => {
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement
    const scrollContainer = messagesRoot.parentElement as HTMLElement
    const samples: LayoutSample[] = []
    const sampler = { isSampling: true, samples }

    ;(window as unknown as { __layoutSampler: typeof sampler })
      .__layoutSampler = sampler

    function sample() {
      const lastUser = Array.from(
        document.querySelectorAll('[data-role="user"] .chat-bubble'),
      ).at(-1) as HTMLElement
      const lastAssistant = Array.from(
        document.querySelectorAll('[data-role="assistant"]'),
      ).at(-1) as HTMLElement | undefined

      samples.push({
        userTop: lastUser.getBoundingClientRect().top
          - scrollContainer.getBoundingClientRect().top,
        scrollTop: scrollContainer.scrollTop,
        hasBubble: !!document.querySelector(
          '[data-testid="tool-approval-bubble"]',
        ),
        hasText: !!lastAssistant?.innerText.includes(text),
      })

      if (sampler.isSampling) {
        requestAnimationFrame(sample)
      }
    }

    requestAnimationFrame(sample)
  }, finalText)
}

async function stopLayoutSampler(page: Page): Promise<LayoutSample[]> {
  return page.evaluate(() => {
    const sampler = (window as unknown as {
      __layoutSampler: { isSampling: boolean, samples: LayoutSample[] }
    }).__layoutSampler

    sampler.isSampling = false

    return sampler.samples
  })
}

async function hasSampledText(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sampler = (window as unknown as {
      __layoutSampler: { samples: LayoutSample[] }
    }).__layoutSampler

    return sampler.samples.some(sample => sample.hasText)
  })
}

for (const { name, size } of VIEWPORTS) {
  test(`${name}: an approval pause shows its bubble, and the continuation is placed like a plain send`, async ({
    browser,
  }) => {
    const plainPage = await openMember(
      browser,
      `e2e-approval-scroll-plain-${name}`,
      size,
      'plain',
    )

    await openChatCase(plainPage, CASE_URL)
    await settleLayout(plainPage)
    await send(plainPage)
    await waitUntilReady(plainPage, AFTER_END)

    const plain = await readComposerMetrics(plainPage)

    const page = await openMember(
      browser,
      `e2e-approval-scroll-${name}`,
      size,
      'approval',
    )

    await openChatCase(page, CASE_URL)
    await settleLayout(page)

    const baseline = await readComposerMetrics(page)

    await send(page)
    await waitUntilReady(page, BEFORE_END)

    const bubble = page.getByTestId('tool-approval-bubble')

    await expect(bubble).toBeVisible()
    await expect.poll(async () => {
      return (await readBubbleClearance(page)).below
    }).toBeGreaterThanOrEqual(0)
    expect((await readBubbleClearance(page)).above).toBeGreaterThanOrEqual(0)
    await expect(page.getByTestId('tool-approval-chip')).toHaveCount(0)

    await page.evaluate(() => {
      const messagesRoot = document.querySelector(
        '[data-testid="chat-messages-container"]',
      ) as HTMLElement

      messagesRoot.parentElement!.scrollTop = 0
    })

    const chip = page.getByTestId('tool-approval-chip')

    await expect(chip).toBeVisible()
    expect(Math.abs(
      (await readComposerMetrics(page)).composerHeight
      - baseline.composerHeight,
    )).toBeLessThanOrEqual(LAYOUT_TOLERANCE)

    await chip.click()
    await expect(bubble.getByTestId('reasoning-approval-step')).toBeFocused()
    await expect(chip).toHaveCount(0)

    await bubble.getByTestId('reasoning-approval-step-allow-once').click()

    await expect.poll(async () => {
      const { lastUserTop } = await readComposerMetrics(page)

      return lastUserTop >= 0 && lastUserTop <= TOP_ALIGNMENT_MAX
    }, { timeout: CONTINUATION_DELAY_MS }).toBe(true)

    await waitUntilReady(page, AFTER_END)
    await expect(bubble).toHaveCount(0)

    const final = await readComposerMetrics(page)

    expect(Math.abs(final.lastUserTop - plain.lastUserTop))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
    expect(Math.abs(final.spacerHeight - plain.spacerHeight))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
    expect(Math.abs(final.composerHeight - plain.composerHeight))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
  })

  test(`${name}: the pinned user message stays at the top after the bubble leaves and before the text arrives`, async ({
    browser,
  }) => {
    const page = await openMember(
      browser,
      `e2e-approval-scroll-delayed-${name}`,
      size,
      'delayed-text',
    )

    await openChatCase(page, CASE_URL)
    await settleLayout(page)
    await send(page)
    await waitUntilReady(page, BEFORE_END)

    const bubble = page.getByTestId('tool-approval-bubble')

    await expect(bubble).toBeVisible()
    await expect.poll(async () => {
      return (await readBubbleClearance(page)).below
    }).toBeGreaterThanOrEqual(0)
    await bubble.getByTestId('reasoning-approval-step-allow-once').click()

    await expect.poll(async () => {
      const { lastUserTop } = await readComposerMetrics(page)

      return lastUserTop >= 0 && lastUserTop <= TOP_ALIGNMENT_MAX
    }, { timeout: CONTINUATION_DELAY_MS }).toBe(true)

    const lastAssistant = page.locator('[data-role="assistant"]').last()
    const tops: number[] = []
    const startedAt = Date.now()
    let hasBubbleLeft = false
    let hasTextArrived = false

    while (!hasTextArrived && Date.now() - startedAt < TEXT_WAIT_MAX_MS) {
      const { lastUserTop } = await readComposerMetrics(page)

      hasBubbleLeft = hasBubbleLeft || await bubble.count() === 0
      hasTextArrived = (await lastAssistant.innerText()).includes(AFTER_END)

      if (hasBubbleLeft && !hasTextArrived) {
        tops.push(lastUserTop)
      }

      await page.waitForTimeout(SAMPLE_INTERVAL_MS)
    }

    expect(hasBubbleLeft).toBe(true)
    expect(tops.length).toBeGreaterThan(0)
    expect(tops.filter((top) => {
      return top < 0 || top > TOP_ALIGNMENT_MAX
    })).toEqual([])
  })

  test(`${name}: a short reply with a reasoning row keeps its position from the click until the final text and ends like a plain send`, async ({
    browser,
  }) => {
    const plainPage = await openMember(
      browser,
      `e2e-approval-scroll-short-plain-${name}`,
      size,
      'short-plain',
    )

    await openChatCase(plainPage, CASE_URL)
    await settleLayout(plainPage)
    await send(plainPage)
    await waitUntilReady(plainPage, SHORT_AFTER_END)

    const plain = await readComposerMetrics(plainPage)

    const page = await openMember(
      browser,
      `e2e-approval-scroll-short-${name}`,
      size,
      'short-delayed',
    )

    await openChatCase(page, CASE_URL)
    await settleLayout(page)
    await send(page)
    await waitUntilReady(page, 'Waiting for your approval')

    const bubble = page.getByTestId('tool-approval-bubble')

    await expect(bubble).toBeVisible()
    await expect.poll(async () => {
      return (await readBubbleClearance(page)).below
    }).toBeGreaterThanOrEqual(0)

    const before = await readComposerMetrics(page)

    expect(before.lastUserTop).toBeGreaterThanOrEqual(0)
    expect(before.lastUserTop).toBeLessThanOrEqual(TOP_ALIGNMENT_MAX)

    await startLayoutSampler(page, SHORT_AFTER_END)
    await bubble.getByTestId('reasoning-approval-step-allow-once').click()
    await expect.poll(() => hasSampledText(page), {
      timeout: TEXT_WAIT_MAX_MS,
    }).toBe(true)
    await waitUntilReady(page, SHORT_AFTER_END)

    const samples = await stopLayoutSampler(page)
    const firstTextIndex = samples.findIndex(sample => sample.hasText)
    const beforeText = samples.slice(0, firstTextIndex)

    expect(beforeText.some(sample => !sample.hasBubble)).toBe(true)
    expect(beforeText.length).toBeGreaterThan(0)
    expect(samples.filter((sample) => {
      return Math.abs(sample.userTop - before.lastUserTop) > LAYOUT_TOLERANCE
        || Math.abs(sample.scrollTop - before.scrollTop) > LAYOUT_TOLERANCE
    })).toEqual([])
    await expect(bubble).toHaveCount(0)

    const final = await readComposerMetrics(page)

    expect(Math.abs(final.lastUserTop - plain.lastUserTop))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
    expect(Math.abs(final.spacerHeight - plain.spacerHeight))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
    expect(Math.abs(final.composerHeight - plain.composerHeight))
      .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
  })
}
