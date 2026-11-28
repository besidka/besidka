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

const SHORT_REPLY_VIEWPORTS = [
  ...VIEWPORTS,
  { name: 'large-phone', size: { width: 430, height: 932 } },
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
const SECOND_REASONING = 'The rail also needs a second edit.'
const SHORT_AFTER_END = 'Done, the rail is updated.'
const LONG_PROMPT = Array.from({ length: 22 }, (_item, index) => {
  return `Change rail number ${index + 1} on the canvas.`
}).join(' ')
const SECOND_CALL_ID = 'approval-scroll-call-2'
const SECOND_APPROVAL_ID = 'approval-scroll-0002'
const MAX_FRAME_MOVE = 2
const SETTLED_PIN_DISTANCE = 24
const SCROLL_AWAY_FROM_PIN_BY = 60
const POST_REPLY_OBSERVATION_MS = 2_000

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

/**
 * A second reasoning row and a second approval, which is how a continuation
 * ends when the model needs another tool.
 */
function secondApprovalChunks() {
  return [
    { type: 'reasoning-start', id: 'reasoning-2' },
    { type: 'reasoning-delta', id: 'reasoning-2', delta: SECOND_REASONING },
    { type: 'reasoning-end', id: 'reasoning-2' },
    { ...TOOL_INPUT_CHUNK, toolCallId: SECOND_CALL_ID },
    {
      type: 'tool-approval-request',
      approvalId: SECOND_APPROVAL_ID,
      toolCallId: SECOND_CALL_ID,
    },
    {
      type: 'data-tool-approval',
      id: SECOND_CALL_ID,
      data: {
        approvalId: SECOND_APPROVAL_ID,
        toolCallId: SECOND_CALL_ID,
        toolName: TOOL_NAME,
        reason: 'always-ask',
        summary: `doop wants to run ${TOOL_NAME}`,
        rememberOptions: ['once', 'chat', 'always'],
      },
    },
  ]
}

function shortFinalChunks(secondCard: boolean) {
  return [
    ...(secondCard
      ? secondApprovalChunks()
      : textChunks('text-2', SHORT_AFTER_END)),
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
function plainChunks(
  variant: 'tall' | 'short' = 'tall',
  secondCard: boolean = false,
) {
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
    ...(variant === 'short'
      ? shortFinalChunks(secondCard)
      : [
        ...textChunks('text-2', AFTER_TEXT),
        { type: 'finish-step' },
        { type: 'finish' },
      ]),
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
  finalChunks: unknown[] = [
    ...textChunks('text-2', AFTER_TEXT),
    { type: 'finish-step' },
    { type: 'finish' },
  ],
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
    textChunks: finalChunks,
  })
}

async function openMember(
  browser: Browser,
  prefix: string,
  size: { width: number, height: number },
  mode: 'approval' | 'plain' | 'delayed-text' | 'short-delayed' | 'short-plain',
  secondCard: boolean = false,
): Promise<Page> {
  const page = await openGrantedMember(browser, prefix, ['tool-approvals'])
  const variant = mode.startsWith('short') ? 'short' : 'tall'

  if (mode === 'delayed-text') {
    await streamContinuationFromPage(page)
  }

  if (mode === 'short-delayed') {
    await streamContinuationFromPage(page, shortFinalChunks(secondCard))
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
      await fulfillStream(route, plainChunks(variant, secondCard))

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

async function send(page: Page, prompt: string = PROMPT) {
  await page.getByTestId('chat-input-textarea').fill(prompt)
  await page.getByTestId('send-message').click()
}

const SETTLE_GAP_MS = 300
const SETTLE_TIMEOUT_MS = 10_000

/**
 * The final adjust runs 150 ms after the reply is ready, which a busy
 * machine can stretch, so the metrics are read once two reads at least
 * 300 ms apart agree.
 */
async function readSettledMetrics(page: Page) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  let previous = await readComposerMetrics(page)

  while (Date.now() < deadline) {
    await page.waitForTimeout(SETTLE_GAP_MS)

    const current = await readComposerMetrics(page)

    if (JSON.stringify(current) === JSON.stringify(previous)) {
      return current
    }

    previous = current
  }

  throw new Error('The composer metrics did not settle')
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
}

interface LayoutSample {
  userTop: number
  scrollTop: number
  hasFinal: boolean
}

interface ShortScenario {
  label: string
  prompt: string
  secondCard: boolean
  scrollCardIntoView: boolean
  scrollBy: number
  instantPinFrames: number
  matchesPlainSend: boolean
}

const SHORT_SCENARIOS: ShortScenario[] = [
  {
    label: 'a short message',
    prompt: PROMPT,
    secondCard: false,
    scrollBy: 0,
    instantPinFrames: 0,
    matchesPlainSend: true,
  },
  {
    label: 'a long message',
    prompt: LONG_PROMPT,
    secondCard: false,
    scrollBy: 0,
    instantPinFrames: 0,
    matchesPlainSend: false,
  },
  {
    label: 'a long message and a second approval',
    prompt: LONG_PROMPT,
    secondCard: true,
    scrollBy: 0,
    instantPinFrames: 0,
    matchesPlainSend: true,
  },
  {
    label: 'a short message with the view scrolled away from the pin',
    prompt: PROMPT,
    secondCard: false,
    scrollBy: -SCROLL_AWAY_FROM_PIN_BY,
    instantPinFrames: 1,
    matchesPlainSend: true,
  },
  {
    label: 'a long message with the view scrolled away from the pin',
    prompt: LONG_PROMPT,
    secondCard: false,
    scrollBy: -SCROLL_AWAY_FROM_PIN_BY,
    instantPinFrames: 1,
    matchesPlainSend: false,
  },
]

/**
 * Reads the pinned user message and the scroll position on every animation
 * frame, before the frame is laid out again, so a layout that the browser
 * clamps and the app only corrects afterwards is recorded too.
 */
async function startLayoutSampler(
  page: Page,
  finalText: string,
  secondCard: boolean,
) {
  await page.evaluate(({ text, expectsBubble }) => {
    const messagesRoot = document.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLElement
    const scrollContainer = messagesRoot.parentElement as HTMLElement
    const samples: LayoutSample[] = []
    const sampler = { isSampling: true, samples }
    let hasBubbleLeft = false

    ;(window as unknown as { __layoutSampler: typeof sampler })
      .__layoutSampler = sampler

    function sample() {
      const lastUser = Array.from(
        document.querySelectorAll('[data-role="user"] .chat-bubble'),
      ).at(-1) as HTMLElement
      const lastAssistant = Array.from(
        document.querySelectorAll('[data-role="assistant"]'),
      ).at(-1) as HTMLElement | undefined
      const hasBubble = !!document.querySelector(
        '[data-testid="tool-approval-bubble"]',
      )

      hasBubbleLeft = hasBubbleLeft || !hasBubble

      samples.push({
        userTop: lastUser.getBoundingClientRect().top
          - scrollContainer.getBoundingClientRect().top,
        scrollTop: scrollContainer.scrollTop,
        hasFinal: expectsBubble
          ? hasBubbleLeft && hasBubble
          : !!lastAssistant?.innerText.includes(text),
      })

      if (sampler.isSampling) {
        requestAnimationFrame(sample)
      }
    }

    requestAnimationFrame(sample)
  }, { text: finalText, expectsBubble: secondCard })
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

async function hasSampledFinal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sampler = (window as unknown as {
      __layoutSampler: { samples: LayoutSample[] }
    }).__layoutSampler

    return sampler.samples.some(sample => sample.hasFinal)
  })
}

function findLargeFrameMoves(samples: LayoutSample[]) {
  return samples.flatMap((sample, index) => {
    const previous = samples[index - 1]

    if (!previous) {
      return []
    }

    const userMove = sample.userTop - previous.userTop
    const scrollMove = sample.scrollTop - previous.scrollTop

    if (
      Math.abs(userMove) <= MAX_FRAME_MOVE
      && Math.abs(scrollMove) <= MAX_FRAME_MOVE
    ) {
      return []
    }

    return [{ index, userMove, scrollMove, userTop: sample.userTop }]
  })
}

for (const { name, size } of SHORT_REPLY_VIEWPORTS) {
  for (const scenario of SHORT_SCENARIOS) {
    test(`${name}: ${scenario.label} keeps its position frame by frame from the click to the end of the reply and ends like a plain send`, async ({
      browser,
    }) => {
      const finalText = scenario.secondCard
        ? 'Waiting for your approval'
        : SHORT_AFTER_END
      const plainPage = await openMember(
        browser,
        `e2e-approval-scroll-short-plain-${name}`,
        size,
        'short-plain',
        scenario.secondCard,
      )

      await openChatCase(plainPage, CASE_URL)
      await settleLayout(plainPage)
      await send(plainPage, scenario.prompt)
      await waitUntilReady(plainPage, finalText)

      const plain = await readSettledMetrics(plainPage)

      const page = await openMember(
        browser,
        `e2e-approval-scroll-short-${name}`,
        size,
        'short-delayed',
        scenario.secondCard,
      )
      await openChatCase(page, CASE_URL)
      await settleLayout(page)
      await send(page, scenario.prompt)
      await waitUntilReady(page, 'Waiting for your approval')

      const bubble = page.getByTestId('tool-approval-bubble')

      await expect(bubble).toBeVisible()
      await expect.poll(async () => {
        return (await readBubbleClearance(page)).below
      }).toBeGreaterThanOrEqual(0)

      if (scenario.scrollBy !== 0) {
        await page.evaluate((distance) => {
          const messagesRoot = document.querySelector(
            '[data-testid="chat-messages-container"]',
          ) as HTMLElement

          messagesRoot.parentElement!.scrollTop += distance
        }, scenario.scrollBy)
        await settleLayout(page)
      }

      await startLayoutSampler(page, finalText, scenario.secondCard)
      await page.waitForTimeout(SAMPLE_INTERVAL_MS * 3)
      await bubble.getByTestId('reasoning-approval-step-allow-once').click()
      await expect.poll(() => hasSampledFinal(page), {
        timeout: TEXT_WAIT_MAX_MS,
      }).toBe(true)
      await waitUntilReady(page, finalText)
      await page.waitForTimeout(POST_REPLY_OBSERVATION_MS)

      const samples = await stopLayoutSampler(page)
      const largeMoves = findLargeFrameMoves(samples)
      const landedTop = samples.at(-1)!.userTop
      const startedAwayFromPin = Math.abs(samples[0].userTop - landedTop)
        > SETTLED_PIN_DISTANCE
      const allowedLargeMoves = scenario.instantPinFrames
        || Number(startedAwayFromPin)

      expect(
        largeMoves.length,
        JSON.stringify(largeMoves),
      ).toBeLessThanOrEqual(allowedLargeMoves)

      const lastMove = largeMoves.at(-1)

      if (lastMove) {
        expect(Math.abs(lastMove.userTop - landedTop))
          .toBeLessThanOrEqual(MAX_FRAME_MOVE)
      }

      const final = await readSettledMetrics(page)

      if (scenario.matchesPlainSend) {
        expect(Math.abs(final.lastUserTop - plain.lastUserTop))
          .toBeLessThanOrEqual(LAYOUT_TOLERANCE)

        if (!scenario.secondCard) {
          expect(Math.abs(final.spacerHeight - plain.spacerHeight))
            .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
        }
      }

      expect(Math.abs(final.composerHeight - plain.composerHeight))
        .toBeLessThanOrEqual(LAYOUT_TOLERANCE)
    })
  }
}
