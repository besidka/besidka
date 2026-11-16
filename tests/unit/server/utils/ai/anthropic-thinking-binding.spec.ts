import type { ModelMessage, PrepareStepFunction, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { generateText, stepCountIs, tool } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import {
  TOOL_INDEX_LOAD_TOOL_NAME,
  TOOL_INDEX_USE_CONNECTOR_TOOL_NAME,
} from '#shared/utils/tool-index'
import { createToolIndex } from '~~/server/utils/ai/tool-index'
import {
  hasSignedAnthropicReasoning,
  withAnthropicThinkingBinding,
} from '~~/server/utils/ai/anthropic-thinking-binding'
import {
  getAnthropicThinkingBinding,
} from '~~/server/utils/providers/anthropic'

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
}))

const DEFERRED_TOOL_NAME = 'mcp__cloudflare__count_workers'
const BINDING_BETA = 'thinking-binding-controls-2026-08-01'

interface CapturedRequest {
  body: {
    tools?: Array<{ name: string }>
    thinking?: Record<string, unknown>
    output_config?: Record<string, unknown>
    messages: Array<{ role: string, content: unknown }>
  }
  betas: string[]
}

type ResponseBlock = Record<string, unknown>

function thinkingBlock(signature: string): ResponseBlock {
  return { type: 'thinking', thinking: 'Plan.', signature }
}

function toolUse(id: string, name: string, input: unknown): ResponseBlock {
  return { type: 'tool_use', id, name, input }
}

function textBlock(text: string): ResponseBlock {
  return { type: 'text', text }
}

function createAnthropicMock(responses: ResponseBlock[][]) {
  const requests: CapturedRequest[] = []

  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const content = responses[requests.length] ?? [textBlock('Done.')]

    requests.push({
      body: JSON.parse(String(init?.body)),
      betas: (headers.get('anthropic-beta') ?? '')
        .split(',')
        .filter(Boolean),
    })

    return new Response(JSON.stringify({
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content,
      stop_reason: content.some(block => block.type === 'tool_use')
        ? 'tool_use'
        : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const anthropic = createAnthropic({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })

  return { model: anthropic('claude-haiku-5-5'), requests }
}

interface SendSetup {
  reasoning?: 'medium'
  catalog?: boolean
  bindFromStart?: boolean
  history?: ModelMessage[]
}

const VALID_THINKING_TYPES = ['adaptive', 'enabled']

function expectValidThinking(requests: CapturedRequest[]) {
  for (const request of requests) {
    const thinking = request.body.thinking

    if (!thinking) {
      continue
    }

    expect(VALID_THINKING_TYPES).toContain(thinking.type)

    if (thinking.type === 'enabled') {
      expect(thinking.budget_tokens).toEqual(expect.any(Number))
    }
  }
}

function createSend(setup: SendSetup) {
  const executeDeferred = vi.fn(async () => {
    return '3 workers'
  })
  const toolIndex = createToolIndex({
    entries: [{
      name: DEFERRED_TOOL_NAME,
      sourceKey: 'cloudflare',
      sourceTitle: 'Cloudflare',
      description: 'Counts Workers.',
      toolClass: 'read',
      bytes: 100,
      ...(setup.catalog ? { catalogKey: 'cloudflare' } : {}),
    }],
    room: { tools: 5, bytes: 10_000 },
    upFrontNames: new Set(),
    ...(setup.catalog
      ? {
        catalog: {
          connectors: [{
            key: 'cloudflare',
            connectorId: 'connector-1',
            title: 'Cloudflare',
            host: 'mcp.cloudflare.com',
            toolCount: 1,
            isLegacySse: false,
          }],
          maxOpen: 3,
          maxOpenLegacySse: 1,
        },
      }
      : {}),
    logger: { set: vi.fn() },
  })

  if (!toolIndex) {
    throw new Error('Expected a tool index')
  }

  const tools: ToolSet = {
    ...toolIndex.tools,
    [DEFERRED_TOOL_NAME]: tool({
      description: 'Counts Workers.',
      inputSchema: z.object({}),
      execute: executeDeferred,
    }),
  }
  const toolNames = Object.keys(tools)
  const thinking = getAnthropicThinkingBinding(
    'claude-haiku-5-5',
    setup.reasoning ?? 'off',
  )

  if (!thinking) {
    throw new Error('Expected a thinking binding for Claude Haiku 5.5')
  }

  const logger = { set: vi.fn() }
  const prepareStep = withAnthropicThinkingBinding({
    base: toolIndex.withActivation({ toolNames }),
    thinking,
    toolNames,
    bindFromStart: setup.bindFromStart,
    logger,
  })

  return { tools, prepareStep, executeDeferred, logger }
}

function toolNamesOf(request: CapturedRequest): string[] {
  return (request.body.tools ?? []).map(entry => entry.name)
}

async function runSend(
  responses: ResponseBlock[][],
  setup: SendSetup = { reasoning: 'medium' },
) {
  const { model, requests } = createAnthropicMock(responses)
  const send = createSend(setup)

  await generateText({
    model,
    instructions: 'You are a test assistant.',
    ...(setup.history
      ? { messages: setup.history }
      : { prompt: 'How many Cloudflare Workers do I have?' }),
    ...(setup.reasoning ? { reasoning: setup.reasoning } : {}),
    tools: send.tools,
    stopWhen: stepCountIs(5),
    prepareStep: send.prepareStep,
  })

  expectValidThinking(requests)

  return { requests, ...send }
}

describe('getAnthropicThinkingBinding', () => {
  it('spells out the adaptive thinking the provider derives, plus the '
    + 'binding', () => {
    expect(getAnthropicThinkingBinding('claude-haiku-5-5', 'high')).toEqual({
      type: 'adaptive',
      display: 'summarized',
      blockBinding: { prefixMismatchBehavior: 'drop_block' },
    })
  })

  it('keeps the default adaptive thinking with the binding when reasoning '
    + 'is off', () => {
    expect(getAnthropicThinkingBinding('claude-sonnet-5-5', 'off')).toEqual({
      type: 'adaptive',
      blockBinding: { prefixMismatchBehavior: 'drop_block' },
    })
  })

  it('is undefined for models without preserved thinking', () => {
    expect(getAnthropicThinkingBinding('claude-opus-5', 'high'))
      .toBeUndefined()
    expect(getAnthropicThinkingBinding('claude-haiku-4-5', 'high'))
      .toBeUndefined()
  })
})

describe('withAnthropicThinkingBinding in an Anthropic send', () => {
  it('drops mismatched thinking once a load changes the tools', async () => {
    const { requests, executeDeferred, logger } = await runSend([
      [
        thinkingBlock('sig-1'),
        toolUse('toolu_1', TOOL_INDEX_LOAD_TOOL_NAME, {
          names: [DEFERRED_TOOL_NAME],
        }),
      ],
      [
        thinkingBlock('sig-2'),
        toolUse('toolu_2', DEFERRED_TOOL_NAME, {}),
      ],
      [textBlock('You have 3 Workers.')],
    ])

    expect(requests).toHaveLength(3)

    const [first, second, third] = requests as [
      CapturedRequest,
      CapturedRequest,
      CapturedRequest,
    ]

    expect(toolNamesOf(first)).toEqual([TOOL_INDEX_LOAD_TOOL_NAME])
    expect(first.body.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
    expect(first.betas).not.toContain(BINDING_BETA)

    expect(toolNamesOf(second)).toEqual([
      TOOL_INDEX_LOAD_TOOL_NAME,
      DEFERRED_TOOL_NAME,
    ])
    expect(second.body.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'thinking', signature: 'sig-1' }),
      ]),
    )

    for (const request of [second, third]) {
      expect(request.body.thinking).toEqual({
        type: 'adaptive',
        display: 'summarized',
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      })
      expect(request.body.output_config).toEqual({ effort: 'medium' })
      expect(request.betas).toContain(BINDING_BETA)
    }

    expect(executeDeferred).toHaveBeenCalledTimes(1)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        anthropicThinking: expect.objectContaining({
          blockBinding: 'drop_block',
        }),
      },
    })
  })

  it('sends every step as before while the tools never change', async () => {
    const { requests, logger } = await runSend([
      [
        thinkingBlock('sig-1'),
        toolUse('toolu_1', TOOL_INDEX_LOAD_TOOL_NAME, {
          names: ['mcp__cloudflare__does_not_exist'],
        }),
      ],
      [textBlock('I cannot look that up.')],
    ])

    expect(requests).toHaveLength(2)

    for (const request of requests) {
      expect(toolNamesOf(request)).toEqual([TOOL_INDEX_LOAD_TOOL_NAME])
      expect(request.body.thinking).toEqual({
        type: 'adaptive',
        display: 'summarized',
      })
      expect(request.betas).not.toContain(BINDING_BETA)
    }

    expect(logger.set).not.toHaveBeenCalled()
  })

  it('never runs a deferred tool the model calls before loading it',
    async () => {
      const { requests, executeDeferred } = await runSend([
        [
          thinkingBlock('sig-1'),
          toolUse('toolu_1', DEFERRED_TOOL_NAME, {}),
        ],
        [textBlock('I need to load it first.')],
      ])

      expect(executeDeferred).not.toHaveBeenCalled()

      for (const request of requests) {
        expect(toolNamesOf(request)).not.toContain(DEFERRED_TOOL_NAME)
      }
    })
  it('binds the same way when use_connector opens a connector', async () => {
    const { requests } = await runSend([
      [
        thinkingBlock('sig-1'),
        toolUse('toolu_1', TOOL_INDEX_USE_CONNECTOR_TOOL_NAME, {
          connector: 'cloudflare',
        }),
      ],
      [textBlock('Opened.')],
    ], { reasoning: 'medium', catalog: true })

    expect(requests).toHaveLength(2)

    const [first, second] = requests as [CapturedRequest, CapturedRequest]

    expect(toolNamesOf(first)).not.toContain(DEFERRED_TOOL_NAME)
    expect(first.body.thinking).not.toHaveProperty('block_binding')
    expect(toolNamesOf(second)).toContain(DEFERRED_TOOL_NAME)
    expect(second.body.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(second.betas).toContain(BINDING_BETA)
  })

  it('sends adaptive thinking with the binding with reasoning off, after a '
    + 'change', async () => {
    const { requests } = await runSend([
      [
        thinkingBlock('sig-1'),
        toolUse('toolu_1', TOOL_INDEX_LOAD_TOOL_NAME, {
          names: [DEFERRED_TOOL_NAME],
        }),
      ],
      [textBlock('Loaded.')],
    ], {})

    const [first, second] = requests as [CapturedRequest, CapturedRequest]

    expect(first.body).not.toHaveProperty('thinking')
    expect(first.betas).not.toContain(BINDING_BETA)
    expect(second.body.thinking).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(second.body).not.toHaveProperty('output_config')
    expect(second.betas).toContain(BINDING_BETA)
  })

  it('binds a later step after use_connector with reasoning off',
    async () => {
      const { requests } = await runSend([
        [
          thinkingBlock('sig-1'),
          toolUse('toolu_1', TOOL_INDEX_USE_CONNECTOR_TOOL_NAME, {
            connector: 'cloudflare',
          }),
        ],
        [
          thinkingBlock('sig-2'),
          toolUse('toolu_2', DEFERRED_TOOL_NAME, {}),
        ],
        [textBlock('You have 3 Workers.')],
      ], { catalog: true })

      expect(requests).toHaveLength(3)

      const [first, ...later] = requests as CapturedRequest[]

      expect(first?.body).not.toHaveProperty('thinking')

      for (const request of later) {
        expect(request.body.thinking).toEqual({
          type: 'adaptive',
          block_binding: { prefix_mismatch_behavior: 'drop_block' },
        })
      }
    })

  it.each([
    ['off', {}],
    ['medium', { reasoning: 'medium' as const }],
  ])('binds an approval resume from the first step with reasoning %s',
    async (_label, reasoningSetup) => {
      const history: ModelMessage[] = [
        { role: 'user', content: 'How many Cloudflare Workers do I have?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'Plan.',
              providerOptions: { anthropic: { signature: 'sig-0' } },
            },
            {
              type: 'tool-call',
              toolCallId: 'toolu_0',
              toolName: TOOL_INDEX_LOAD_TOOL_NAME,
              input: { names: [DEFERRED_TOOL_NAME] },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'toolu_0',
            toolName: TOOL_INDEX_LOAD_TOOL_NAME,
            output: { type: 'json', value: { loaded: [DEFERRED_TOOL_NAME] } },
          }],
        },
      ]
      const { requests } = await runSend([
        [textBlock('You have 3 Workers.')],
      ], { ...reasoningSetup, bindFromStart: true, history })

      expect(requests).toHaveLength(1)
      expect(requests[0]?.body.thinking).toEqual({
        type: 'adaptive',
        ...(reasoningSetup.reasoning ? { display: 'summarized' } : {}),
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      })
      expect(requests[0]?.betas).toContain(BINDING_BETA)
    })

  it('sends no binding when no thinking block is replayed', async () => {
    const { requests } = await runSend([
      [
        toolUse('toolu_1', TOOL_INDEX_LOAD_TOOL_NAME, {
          names: [DEFERRED_TOOL_NAME],
        }),
      ],
      [textBlock('Loaded.')],
    ], {})

    const [, second] = requests as [CapturedRequest, CapturedRequest]

    expect(toolNamesOf(second)).toContain(DEFERRED_TOOL_NAME)
    expect(second.body).not.toHaveProperty('thinking')
    expect(second.betas).not.toContain(BINDING_BETA)
  })
})

describe('hasSignedAnthropicReasoning', () => {
  it('is true only for a reasoning part Anthropic signed or redacted', () => {
    expect(hasSignedAnthropicReasoning([
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'Plan.' }, {
          type: 'text',
          text: 'Hello.',
        }],
      },
    ])).toBe(false)
    expect(hasSignedAnthropicReasoning([{
      role: 'assistant',
      content: [{
        type: 'reasoning',
        text: '',
        providerOptions: { anthropic: { signature: 'sig-1' } },
      }],
    }])).toBe(true)
    expect(hasSignedAnthropicReasoning([{
      role: 'assistant',
      content: [{
        type: 'reasoning',
        text: '',
        providerOptions: { anthropic: { redactedData: 'data' } },
      }],
    }])).toBe(true)
  })
})

describe('withAnthropicThinkingBinding', () => {
  const thinking = {
    type: 'adaptive',
    blockBinding: { prefixMismatchBehavior: 'drop_block' },
  }

  const signedMessages = [{
    role: 'assistant',
    content: [{
      type: 'reasoning',
      text: '',
      providerOptions: { anthropic: { signature: 'sig-1' } },
    }],
  }]

  function stepOptions(
    stepNumber: number,
    messages: unknown[] = signedMessages,
  ) {
    return {
      stepNumber,
      steps: [],
      instructions: 'Base.',
      messages,
    } as unknown as Parameters<PrepareStepFunction<ToolSet>>[0]
  }

  it('binds from the first step for a resume that replays thinking',
    async () => {
      const prepareStep = withAnthropicThinkingBinding({
        thinking: thinking as never,
        toolNames: ['search'],
        bindFromStart: true,
      })

      expect(await prepareStep(stepOptions(0))).toEqual({
        providerOptions: { anthropic: { thinking } },
      })
      expect(await prepareStep(stepOptions(0, []))).toBeUndefined()
    })

  it('binds from the step whose instructions change, such as the forced '
    + 'final step', async () => {
    const base = vi.fn(async (options: { stepNumber: number }) => {
      return options.stepNumber === 2
        ? { instructions: 'Base. Answer now.' }
        : undefined
    })
    const prepareStep = withAnthropicThinkingBinding({
      base: base as unknown as PrepareStepFunction<ToolSet>,
      thinking: thinking as never,
      toolNames: ['search'],
    })

    expect(await prepareStep(stepOptions(0))).toBeUndefined()
    expect(await prepareStep(stepOptions(1))).toBeUndefined()
    expect(await prepareStep(stepOptions(2))).toEqual({
      instructions: 'Base. Answer now.',
      providerOptions: { anthropic: { thinking } },
    })
  })

  it('keeps the base provider options and stays bound once changed',
    async () => {
      const results = [
        { activeTools: ['a'] },
        {
          activeTools: ['a', 'b'],
          providerOptions: { anthropic: { container: { id: 'c1' } } },
        },
        { activeTools: ['a'] },
      ]
      const base = vi.fn(async (options: { stepNumber: number }) => {
        return results[options.stepNumber]
      })
      const prepareStep = withAnthropicThinkingBinding({
        base: base as unknown as PrepareStepFunction<ToolSet>,
        thinking: thinking as never,
        toolNames: ['a', 'b'],
      })

      expect(await prepareStep(stepOptions(0))).toEqual({
        activeTools: ['a'],
      })
      expect(await prepareStep(stepOptions(1))).toEqual({
        activeTools: ['a', 'b'],
        providerOptions: {
          anthropic: { container: { id: 'c1' }, thinking },
        },
      })
      expect(await prepareStep(stepOptions(2))).toEqual({
        activeTools: ['a'],
        providerOptions: { anthropic: { thinking } },
      })
    })
})
