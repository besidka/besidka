import type { ImageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import {
  resolveToolLoopOptions,
  TOOL_LOOP_MAX_STEPS,
  TOOL_LOOP_MAX_TOOL_STEPS,
  TOOL_LOOP_TOOL_TIMEOUT_MS,
  TOOL_LOOP_TOTAL_TIMEOUT_MS,
  toolRequiresFollowUpTurn,
  withFollowUpTurn,
} from '../../../../server/utils/ai/tool-loop'
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
})
