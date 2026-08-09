import type { ImageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import {
  resolveToolLoopOptions,
  TOOL_LOOP_MAX_STEPS,
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
    id: 'gateway.perplexitySearch' as const,
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
    })
  })

  it('triggers when a marked tool sits alongside unmarked ones', () => {
    const options = resolveToolLoopOptions({
      generate_image: createRealImageGenerationTool(),
      fixture_search: createFixtureFollowUpTool(),
    })

    expect(options).toBeDefined()
  })

  it('caps the loop below the 600s generation-in-progress guard', () => {
    expect(TOOL_LOOP_MAX_STEPS).toBe(3)
    expect(TOOL_LOOP_TOTAL_TIMEOUT_MS).toBeLessThan(600_000)
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
})
