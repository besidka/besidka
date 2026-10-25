import type { ImageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import {
  getToolLoopMaxSteps,
  resolveToolLoop,
  resolveToolLoopOptions,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_MAX_TOOL_STEPS,
  TOOL_LOOP_TOOL_TIMEOUT_MS,
  TOOL_LOOP_TOTAL_TIMEOUT_MS,
  toolRequiresFollowUpTurn,
  withFollowUpTurn,
} from '../../../../server/utils/ai/tool-loop'
import {
  CHAT_SEARCH_INSTRUCTION,
  CHAT_SEARCH_TOOL_NAMES,
} from '../../../../server/utils/ai/chat-search-tools'
import {
  isProjectKnowledgeToolName,
  PROJECT_KNOWLEDGE_TOOL_NAMES,
} from '../../../../server/utils/ai/knowledge-tools'
import { createImageGenerationTool } from '../../../../server/utils/ai/image-generation'
import { createFixtureFollowUpTool } from '../../../fixtures/follow-up-turn-tool'

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: vi.fn(),
}))

vi.mock('~~/server/utils/ai/image-generation-lock', () => ({
  acquireImageGenerationLease: vi.fn(),
  releaseImageGenerationLease: vi.fn(),
}))

function createRealImageGenerationTool() {
  return createImageGenerationTool({
    userId: 1,
    provider: 'openai',
    model: 'gpt-image-2',
    imageModel: {} as ImageModel,
    logger: { set: vi.fn() },
  })
}

function createProviderExecutedSearchTool() {
  return {
    type: 'provider' as const,
    id: 'provider.webSearch' as const,
    args: {},
    inputSchema: z.object({}),
  }
}

describe('tool loop trigger', () => {
  it('is false for every tool shape that exists in the app today', () => {
    expect(resolveToolLoopOptions(undefined)).toBeUndefined()
    expect(resolveToolLoopOptions({})).toBeUndefined()
    expect(resolveToolLoopOptions({
      generate_image: createRealImageGenerationTool(),
    })).toBeUndefined()
    expect(resolveToolLoopOptions({
      web_search: createProviderExecutedSearchTool(),
    })).toBeUndefined()
  })

  it('is false for the real image generation tool even though it has a '
    + 'client-side execute()', () => {
    const imageTool = createRealImageGenerationTool()

    expect(typeof imageTool.execute).toBe('function')
    expect(toolRequiresFollowUpTurn(imageTool)).toBe(false)
  })

  it('is false for a plain tool with an execute(), so having execute() is '
    + 'never the trigger', () => {
    const plainTool = tool({
      description: 'plain',
      inputSchema: z.object({ query: z.string() }),
      async execute() {
        return { ok: true }
      },
    })

    expect(toolRequiresFollowUpTurn(plainTool)).toBe(false)
    expect(resolveToolLoopOptions({ plain: plainTool })).toBeUndefined()
  })

  it('is true only when a tool carries the explicit marker', () => {
    const fixtureTool = createFixtureFollowUpTool()

    expect(toolRequiresFollowUpTurn(fixtureTool)).toBe(true)

    const options = resolveToolLoopOptions({ fixture_search: fixtureTool })

    expect(options).toEqual({
      stopWhen: expect.any(Function),
      timeout: {
        totalMs: TOOL_LOOP_TOTAL_TIMEOUT_MS,
        toolMs: TOOL_LOOP_TOOL_TIMEOUT_MS,
      },
      prepareStep: expect.any(Function),
    })
  })

  it('triggers when a marked tool sits alongside unmarked ones', () => {
    const options = resolveToolLoopOptions({
      generate_image: createRealImageGenerationTool(),
      fixture_search: createFixtureFollowUpTool(),
    })

    expect(options).toBeDefined()
  })

  it('keeps the step and timeout budgets consistent', () => {
    expect(TOOL_LOOP_MAX_TOOL_STEPS).toBe(3)
    expect(TOOL_LOOP_MAX_STEPS).toBe(TOOL_LOOP_MAX_TOOL_STEPS + 1)
    expect(TOOL_LOOP_TOOL_TIMEOUT_MS).toBeLessThan(TOOL_LOOP_TOTAL_TIMEOUT_MS)
  })

  it('stops the loop at the configured step count', async () => {
    const options = resolveToolLoopOptions({
      fixture_search: createFixtureFollowUpTool(),
    })
    const steps = Array.from({ length: TOOL_LOOP_MAX_STEPS }, () => ({}))
    const beforeCap = await options?.stopWhen({
      steps: steps.slice(0, TOOL_LOOP_MAX_STEPS - 1),
    } as any)
    const atCap = await options?.stopWhen({ steps } as any)

    expect(beforeCap).toBe(false)
    expect(atCap).toBe(true)
  })

  it('keeps the marker off the wire-relevant tool fields', () => {
    const fixtureTool = createFixtureFollowUpTool()

    expect(fixtureTool.description).toBeDefined()
    expect(fixtureTool.inputSchema).toBeDefined()
    expect(typeof fixtureTool.execute).toBe('function')
    expect(withFollowUpTurn({ a: 1 })).toEqual({
      a: 1,
      requiresFollowUpTurn: true,
    })
  })

  describe('final-step prepareStep', () => {
    function getPrepareStep() {
      const options = resolveToolLoopOptions({
        fixture_search: createFixtureFollowUpTool(),
      })

      if (!options) {
        throw new Error('expected tool loop options to be defined')
      }

      return options.prepareStep
    }

    it('does nothing before the final allowed step', async () => {
      const prepareStep = getPrepareStep()
      const earlierStepNumbers = Array.from(
        { length: TOOL_LOOP_MAX_STEPS - 1 },
        (_, index) => index,
      )

      for (const stepNumber of earlierStepNumbers) {
        const result = await prepareStep({ stepNumber } as any)

        expect(result).toBeUndefined()
      }
    })

    it('forces toolChoice: none and appends the answer-now instructions '
      + 'for a non-Anthropic model on the final step', async () => {
      const prepareStep = getPrepareStep()
      const result = await prepareStep({
        stepNumber: TOOL_LOOP_MAX_STEPS - 1,
        model: { provider: 'openai.chat', modelId: 'gpt-5.5' },
        instructions: 'Base instructions.',
      } as any)

      expect(result?.toolChoice).toBe('none')
      expect(typeof result?.instructions).toBe('string')
      expect(result?.instructions as string)
        .toContain('Base instructions.')
      expect((result?.instructions as string).length).toBeGreaterThan(0)
    })

    it('leaves tools declared and only nudges via instructions for an '
      + 'Anthropic model on the final step', async () => {
      const prepareStep = getPrepareStep()
      const result = await prepareStep({
        stepNumber: TOOL_LOOP_MAX_STEPS - 1,
        model: {
          provider: 'anthropic.messages',
          modelId: 'claude-sonnet-4-5',
        },
        instructions: undefined,
      } as any)

      expect(result?.toolChoice).toBeUndefined()
      expect(result?.activeTools).toBeUndefined()
      expect(typeof result?.instructions).toBe('string')
      expect((result?.instructions as string).length).toBeGreaterThan(0)
    })

    it.each([
      ['google', 'google.generative-ai', 'gemini-3.8-flash'],
      ['openai', 'openai.responses', 'gpt-5.5'],
      ['xai', 'xai.responses', 'grok-4.3'],
      ['deepseek', 'deepseek.chat', 'deepseek-v4-flash'],
      ['moonshotai', 'moonshotai.chat', 'kimi-k2.6'],
      ['qwen', 'qwen.chat', 'qwen3.6-plus'],
      ['vercel gateway', 'gateway', 'google/gemini-3.8-flash'],
      ['openrouter gateway', 'openrouter.chat', 'openai/gpt-5.5'],
      ['cloudflare gateway', 'cloudflare-gateway.chat', 'openai/gpt-5.5'],
    ])('removes every tool declaration on the final step for %s',
      async (_label, provider, modelId) => {
        const prepareStep = getPrepareStep()
        const result = await prepareStep({
          stepNumber: TOOL_LOOP_MAX_STEPS - 1,
          model: { provider, modelId },
          instructions: undefined,
        } as any)

        expect(result?.toolChoice).toBe('none')
        expect(result?.activeTools).toEqual([])
      })

    it('keeps the declarations with toolChoice: none for an Anthropic model '
      + 'routed through a gateway', async () => {
      const prepareStep = getPrepareStep()
      const result = await prepareStep({
        stepNumber: TOOL_LOOP_MAX_STEPS - 1,
        model: { provider: 'gateway', modelId: 'anthropic/claude-sonnet-4.5' },
        instructions: undefined,
      } as any)

      expect(result?.toolChoice).toBe('none')
      expect(result?.activeTools).toBeUndefined()
    })

    it.each([
      ['openrouter alias', 'openrouter.chat', '~anthropic/claude-opus-latest'],
      ['openrouter', 'openrouter.chat', 'anthropic/claude-opus-5'],
      ['cloudflare unified', 'cloudflare.chat', 'anthropic/claude-sonnet-4-5'],
    ])('keeps the declarations for an Anthropic model on %s',
      async (_label, provider, modelId) => {
        const prepareStep = getPrepareStep()
        const result = await prepareStep({
          stepNumber: TOOL_LOOP_MAX_STEPS - 1,
          model: { provider, modelId },
          instructions: undefined,
        } as any)

        expect(result?.toolChoice).toBe('none')
        expect(result?.activeTools).toBeUndefined()
      })
  })

  describe('separate chat-search step budget', () => {
    const CHAT_SEARCH_STEPS = 3
    const WEB_ONLY_CAP = TOOL_LOOP_MAX_TOOL_STEPS + 1
    const WEB_AND_CHAT_CAP = TOOL_LOOP_MAX_TOOL_STEPS + CHAT_SEARCH_STEPS + 1
    const CHAT_ONLY_CAP = CHAT_SEARCH_STEPS + 1

    function createWebTools() {
      return { web_search_brave: createFixtureFollowUpTool() }
    }

    function createChatTools() {
      return {
        search_chats: createFixtureFollowUpTool(),
        read_chat: createFixtureFollowUpTool(),
      }
    }

    async function getForcedStepNumbers(
      tools: Parameters<typeof resolveToolLoop>[0],
      stepCount: number,
    ) {
      const resolved = resolveToolLoop(tools, {
        chatSearchSteps: CHAT_SEARCH_STEPS,
      })
      const forcedStepNumbers: number[] = []

      for (let stepNumber = 0; stepNumber < stepCount; stepNumber++) {
        const result = await resolved?.options.prepareStep({
          stepNumber,
          model: { provider: 'openai.chat', modelId: 'gpt-5.5' },
          instructions: undefined,
        } as any)

        if (result) {
          forcedStepNumbers.push(stepNumber)
        }
      }

      return forcedStepNumbers
    }

    it('names the chat-search tools the memory module registers', () => {
      expect(CHAT_SEARCH_TOOL_NAMES).toEqual(['search_chats', 'read_chat'])
      expect(CHAT_SEARCH_INSTRUCTION).toContain('`search_chats`')
      expect(CHAT_SEARCH_INSTRUCTION).toContain('`read_chat`')
    })

    it('keeps the cap at four for web tools only, with or without a budget',
      () => {
        expect(getToolLoopMaxSteps(createWebTools())).toBe(WEB_ONLY_CAP)
        expect(getToolLoopMaxSteps(createWebTools(), {
          chatSearchSteps: CHAT_SEARCH_STEPS,
        })).toBe(WEB_ONLY_CAP)
        expect(WEB_ONLY_CAP).toBe(TOOL_LOOP_MAX_STEPS)
      })

    it('adds the chat-search steps on top of the web steps', () => {
      expect(getToolLoopMaxSteps({
        ...createWebTools(),
        ...createChatTools(),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS })).toBe(WEB_AND_CHAT_CAP)
      expect(WEB_AND_CHAT_CAP).toBe(7)
    })

    it('grants only the chat-search steps when no web tool is registered',
      () => {
        expect(getToolLoopMaxSteps(createChatTools(), {
          chatSearchSteps: CHAT_SEARCH_STEPS,
        })).toBe(CHAT_ONLY_CAP)
        expect(CHAT_ONLY_CAP).toBe(4)
      })

    it('counts one chat-search tool the same as two', () => {
      expect(getToolLoopMaxSteps({
        read_chat: createFixtureFollowUpTool(),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS })).toBe(CHAT_ONLY_CAP)
    })

    it('falls back to the default tool steps when the chat-search budget '
      + 'is zero', () => {
      expect(getToolLoopMaxSteps(createChatTools())).toBe(TOOL_LOOP_MAX_STEPS)
      expect(getToolLoopMaxSteps(createChatTools(), {
        chatSearchSteps: 0,
      })).toBe(TOOL_LOOP_MAX_STEPS)
    })

    it('is undefined when no tool carries the follow-up marker', () => {
      expect(getToolLoopMaxSteps(undefined)).toBeUndefined()
      expect(getToolLoopMaxSteps({
        search_chats: tool({
          description: 'unmarked',
          inputSchema: z.object({}),
          async execute() {
            return {}
          },
        }),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS })).toBeUndefined()
    })

    it('does not leak the cap into the options spread into streamText', () => {
      const resolved = resolveToolLoop({
        ...createWebTools(),
        ...createChatTools(),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS })

      expect(Object.keys(resolved?.options ?? {}).sort()).toEqual([
        'prepareStep',
        'stopWhen',
        'timeout',
      ])
      expect(Object.keys(resolveToolLoopOptions({
        ...createWebTools(),
        ...createChatTools(),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS }) ?? {}).sort()).toEqual([
        'prepareStep',
        'stopWhen',
        'timeout',
      ])
    })

    it('stops the raised loop at its own cap', async () => {
      const options = resolveToolLoopOptions({
        ...createWebTools(),
        ...createChatTools(),
      }, { chatSearchSteps: CHAT_SEARCH_STEPS })
      const steps = Array.from({ length: WEB_AND_CHAT_CAP }, () => ({}))
      const atOldCap = await options?.stopWhen({
        steps: steps.slice(0, TOOL_LOOP_MAX_STEPS),
      } as any)
      const beforeCap = await options?.stopWhen({
        steps: steps.slice(0, WEB_AND_CHAT_CAP - 1),
      } as any)
      const atCap = await options?.stopWhen({ steps } as any)

      expect(atOldCap).toBe(false)
      expect(beforeCap).toBe(false)
      expect(atCap).toBe(true)
    })

    it('forces the answer on the last step of the raised cap and not on the '
      + 'old final index', async () => {
      const forcedStepNumbers = await getForcedStepNumbers({
        ...createWebTools(),
        ...createChatTools(),
      }, WEB_AND_CHAT_CAP + 1)

      expect(forcedStepNumbers).toEqual([WEB_AND_CHAT_CAP - 1])
      expect(forcedStepNumbers).not.toContain(TOOL_LOOP_MAX_STEPS - 1)
    })

    it('forces the answer on the last step of a chat-only loop', async () => {
      const forcedStepNumbers = await getForcedStepNumbers(
        createChatTools(),
        CHAT_ONLY_CAP + 1,
      )

      expect(forcedStepNumbers).toEqual([CHAT_ONLY_CAP - 1])
    })

    it('keeps forcing on the old final index for web tools only', async () => {
      const forcedStepNumbers = await getForcedStepNumbers(
        createWebTools(),
        WEB_AND_CHAT_CAP,
      )

      expect(forcedStepNumbers).toEqual([TOOL_LOOP_MAX_STEPS - 1])
    })
  })

  describe('memory tools in the shared lookup budget', () => {
    const LOOKUP_STEPS = 3
    const LOOKUP_ONLY_CAP = LOOKUP_STEPS + 1
    const WEB_AND_LOOKUP_CAP = TOOL_LOOP_MAX_TOOL_STEPS + LOOKUP_STEPS + 1

    function createMemoryTools() {
      return {
        memory_list: createFixtureFollowUpTool(),
        memory_read: createFixtureFollowUpTool(),
        memory_write: createFixtureFollowUpTool(),
        memory_forget: createFixtureFollowUpTool(),
      }
    }

    it('grants only the lookup steps when memory tools are the only '
      + 'follow-up tools', () => {
      expect(getToolLoopMaxSteps(createMemoryTools(), {
        chatSearchSteps: LOOKUP_STEPS,
      })).toBe(LOOKUP_ONLY_CAP)
    })

    it('never counts a memory tool as another follow-up tool, so web '
      + 'search keeps its own rounds on top', () => {
      expect(getToolLoopMaxSteps({
        web_search_brave: createFixtureFollowUpTool(),
        ...createMemoryTools(),
      }, { chatSearchSteps: LOOKUP_STEPS })).toBe(WEB_AND_LOOKUP_CAP)
      expect(getToolLoopMaxSteps({
        ...createMemoryTools(),
      }, { chatSearchSteps: LOOKUP_STEPS })).not.toBe(WEB_AND_LOOKUP_CAP)
    })

    it('does not add steps twice when chat-search and memory tools are '
      + 'registered together', () => {
      expect(getToolLoopMaxSteps({
        search_chats: createFixtureFollowUpTool(),
        read_chat: createFixtureFollowUpTool(),
        ...createMemoryTools(),
      }, { chatSearchSteps: LOOKUP_STEPS })).toBe(LOOKUP_ONLY_CAP)
    })

    it('falls back to the default tool steps without a lookup budget, '
      + 'never a single step', () => {
      expect(getToolLoopMaxSteps(createMemoryTools())).toBe(TOOL_LOOP_MAX_STEPS)
      expect(getToolLoopMaxSteps(createMemoryTools(), {
        chatSearchSteps: 0,
      })).toBe(TOOL_LOOP_MAX_STEPS)
    })

    it('does not trigger the loop for unmarked memory tools', () => {
      expect(getToolLoopMaxSteps({
        memory_read: tool({
          description: 'unmarked',
          inputSchema: z.object({}),
          async execute() {
            return {}
          },
        }),
      }, { chatSearchSteps: LOOKUP_STEPS })).toBeUndefined()
    })
  })

  describe('untrusted content guard', () => {
    const MODEL = { provider: 'openai.chat', modelId: 'gpt-5.5' }

    function createGuardedPrepareStep() {
      const guard = { untrustedResultSeen: false }
      const options = resolveToolLoopOptions({
        fixture_search: createFixtureFollowUpTool(),
      }, { guard })

      if (!options) {
        throw new Error('expected tool loop options to be defined')
      }

      return { guard, prepareStep: options.prepareStep }
    }

    function createStep(toolName: string, type = 'tool-result') {
      return {
        content: [{ type, toolName, toolCallId: 'call-1' }],
        toolResults: type === 'tool-result'
          ? [{ type, toolName, toolCallId: 'call-1' }]
          : [],
      }
    }

    function prepare(
      prepareStep: ReturnType<typeof createGuardedPrepareStep>['prepareStep'],
      steps: unknown[],
      stepNumber = steps.length,
    ) {
      return prepareStep({
        steps,
        stepNumber,
        model: MODEL,
        instructions: undefined,
      } as any)
    }

    it('stays false with no previous steps', async () => {
      const { guard, prepareStep } = createGuardedPrepareStep()

      await prepare(prepareStep, [], 0)

      expect(guard.untrustedResultSeen).toBe(false)
    })

    it.each([
      'web_search_brave',
      'web_search',
      'google_search',
      'search_chats',
      'read_chat',
      'search_project_knowledge',
      'read_project_knowledge',
    ])('is set by a %s result in a previous step', async (toolName) => {
      const { guard, prepareStep } = createGuardedPrepareStep()

      await prepare(prepareStep, [createStep(toolName)])

      expect(guard.untrustedResultSeen).toBe(true)
    })

    it('is set by a provider-executed result found only in step content',
      async () => {
        const { guard, prepareStep } = createGuardedPrepareStep()

        await prepare(prepareStep, [{
          content: [{
            type: 'tool-result',
            toolName: 'web_search',
            providerExecuted: true,
          }],
        }])

        expect(guard.untrustedResultSeen).toBe(true)
      })

    it('is set by a failed non-memory tool call', async () => {
      const { guard, prepareStep } = createGuardedPrepareStep()

      await prepare(prepareStep, [createStep('web_search_exa', 'tool-error')])

      expect(guard.untrustedResultSeen).toBe(true)
    })

    it.each([
      'memory_list',
      'memory_read',
      'memory_write',
      'memory_forget',
    ])('is not set by a %s result', async (toolName) => {
      const { guard, prepareStep } = createGuardedPrepareStep()

      await prepare(prepareStep, [
        createStep(toolName),
        createStep(toolName, 'tool-error'),
      ])

      expect(guard.untrustedResultSeen).toBe(false)
    })

    it('ignores tool calls without results and plain text steps',
      async () => {
        const { guard, prepareStep } = createGuardedPrepareStep()

        await prepare(prepareStep, [
          {
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'tool-call', toolName: 'web_search' },
            ],
            toolResults: [],
          },
        ])

        expect(guard.untrustedResultSeen).toBe(false)
      })

    it('is set when an untrusted result follows memory results and is '
      + 'never reset afterwards', async () => {
      const { guard, prepareStep } = createGuardedPrepareStep()

      await prepare(prepareStep, [createStep('memory_list')])

      expect(guard.untrustedResultSeen).toBe(false)

      await prepare(prepareStep, [
        createStep('memory_list'),
        createStep('web_search_brave'),
      ])

      expect(guard.untrustedResultSeen).toBe(true)

      await prepare(prepareStep, [createStep('memory_list')])

      expect(guard.untrustedResultSeen).toBe(true)
    })

    it('changes nothing else: declarations and non-final steps stay as '
      + 'they were', async () => {
      const { prepareStep } = createGuardedPrepareStep()
      const unguarded = resolveToolLoopOptions({
        fixture_search: createFixtureFollowUpTool(),
      })
      const steps = [createStep('web_search_brave')]

      expect(await prepare(prepareStep, steps, 1)).toBeUndefined()

      const finalStepNumber = TOOL_LOOP_MAX_STEPS - 1
      const guardedFinal = await prepare(prepareStep, steps, finalStepNumber)
      const unguardedFinal = await unguarded?.prepareStep({
        steps,
        stepNumber: finalStepNumber,
        model: MODEL,
        instructions: undefined,
      } as any)

      expect(guardedFinal).toEqual(unguardedFinal)
      expect(guardedFinal?.toolChoice).toBe('none')
    })

    it('works without a guard and without a steps argument', async () => {
      const options = resolveToolLoopOptions({
        fixture_search: createFixtureFollowUpTool(),
      })

      expect(await options?.prepareStep({ stepNumber: 0 } as any))
        .toBeUndefined()
    })
  })

  describe('separate project knowledge step budget', () => {
    const LOOKUP_STEPS = 3
    const KNOWLEDGE_STEPS = 3

    function createWebTools() {
      return { web_search_brave: createFixtureFollowUpTool() }
    }

    function createLookupTools() {
      return {
        search_chats: createFixtureFollowUpTool(),
        memory_list: createFixtureFollowUpTool(),
      }
    }

    function createKnowledgeTools() {
      return {
        search_project_knowledge: createFixtureFollowUpTool(),
        read_project_knowledge: createFixtureFollowUpTool(),
      }
    }

    const fullBudget = {
      chatSearchSteps: LOOKUP_STEPS,
      knowledgeSteps: KNOWLEDGE_STEPS,
    }

    it('names the knowledge tools the knowledge module registers', () => {
      expect(PROJECT_KNOWLEDGE_TOOL_NAMES).toEqual([
        'search_project_knowledge',
        'read_project_knowledge',
      ])
      expect(isProjectKnowledgeToolName('read_project_knowledge')).toBe(true)
      expect(isProjectKnowledgeToolName('search_chats')).toBe(false)
    })

    it('grants only the knowledge steps when knowledge tools are the only '
      + 'follow-up tools', () => {
      expect(getToolLoopMaxSteps(createKnowledgeTools(), fullBudget)).toBe(4)
    })

    it('never counts a knowledge tool as a web tool, so no web rounds are '
      + 'granted without a web tool', () => {
      expect(getToolLoopMaxSteps({
        ...createLookupTools(),
        ...createKnowledgeTools(),
      }, fullBudget)).toBe(7)
    })

    it('adds the knowledge steps on top of web and lookup steps', () => {
      expect(getToolLoopMaxSteps({
        ...createWebTools(),
        ...createLookupTools(),
        ...createKnowledgeTools(),
      }, fullBudget)).toBe(10)
      expect(getToolLoopMaxSteps({
        ...createWebTools(),
        ...createKnowledgeTools(),
      }, fullBudget)).toBe(7)
    })

    it('ignores the knowledge allowance when no knowledge tool is '
      + 'registered', () => {
      expect(getToolLoopMaxSteps(createWebTools(), fullBudget)).toBe(4)
    })

    it('falls back to the default tool steps when the knowledge budget is '
      + 'missing or zero', () => {
      expect(getToolLoopMaxSteps(createKnowledgeTools()))
        .toBe(TOOL_LOOP_MAX_STEPS)
      expect(getToolLoopMaxSteps(createKnowledgeTools(), {
        knowledgeSteps: 0,
      })).toBe(TOOL_LOOP_MAX_STEPS)
      expect(getToolLoopMaxSteps(createKnowledgeTools(), {
        knowledgeSteps: -2,
      })).toBe(TOOL_LOOP_MAX_STEPS)
    })

    it('forces the answer only on the last step of the ten-step cap',
      async () => {
        const resolved = resolveToolLoop({
          ...createWebTools(),
          ...createLookupTools(),
          ...createKnowledgeTools(),
        }, fullBudget)
        const forcedStepNumbers: number[] = []

        for (let stepNumber = 0; stepNumber < 10; stepNumber++) {
          const result = await resolved?.options.prepareStep({
            stepNumber,
            model: { provider: 'openai.chat', modelId: 'gpt-5.5' },
            instructions: undefined,
          } as any)

          if (result) {
            forcedStepNumbers.push(stepNumber)
          }
        }

        expect(resolved?.maxSteps).toBe(10)
        expect(forcedStepNumbers).toEqual([9])
      })
  })
})
