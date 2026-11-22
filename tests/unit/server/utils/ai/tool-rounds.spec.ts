import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { TOOL_ROUNDS_PER_MESSAGE } from '#shared/utils/tool-rounds'
import {
  TOOL_ROUND_LAST_INSTRUCTIONS,
  TOOL_ROUND_PROGRESS_INSTRUCTIONS,
  resolveToolBudgetReason,
  toolRoundFinalInstructions,
  withToolBudgetPart,
} from '~~/server/utils/ai/tool-rounds'

const BASE = {
  isPaused: false,
  hadError: false,
  reachedStepLimit: false,
  reachedCallLimit: false,
  ranTaskTools: true,
}

const DATA = {
  round: 1,
  maxRounds: TOOL_ROUNDS_PER_MESSAGE,
  reason: 'steps' as const,
  model: 'deepseek-v4-pro',
  gateway: null,
  reasoning: 'high' as const,
  connectorIds: ['c1'],
}

async function collect(
  chunks: UIMessageChunk[],
  decide: (hadError: boolean) => typeof DATA | null,
) {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk))
      controller.close()
    },
  })
  const output: UIMessageChunk[] = []

  for await (const chunk of withToolBudgetPart(stream, decide)) {
    output.push(chunk)
  }

  return output
}

describe('resolveToolBudgetReason', () => {
  it('names the budget a working send stopped on', () => {
    expect(resolveToolBudgetReason({ ...BASE, reachedStepLimit: true }))
      .toBe('steps')
    expect(resolveToolBudgetReason({
      ...BASE,
      reachedStepLimit: true,
      reachedCallLimit: true,
    })).toBe('calls')
  })

  it('never continues a send that finished, paused, failed or ran no task '
    + 'tool', () => {
    expect(resolveToolBudgetReason(BASE)).toBeNull()

    for (const override of [
      { isPaused: true },
      { hadError: true },
      { ranTaskTools: false },
    ]) {
      expect(resolveToolBudgetReason({
        ...BASE,
        reachedStepLimit: true,
        ...override,
      })).toBeNull()
    }
  })
})

describe('toolRoundFinalInstructions', () => {
  it('asks for progress while rounds remain and a summary in the last one',
    () => {
      expect(toolRoundFinalInstructions(1))
        .toBe(TOOL_ROUND_PROGRESS_INSTRUCTIONS)
      expect(toolRoundFinalInstructions(TOOL_ROUNDS_PER_MESSAGE))
        .toBe(TOOL_ROUND_LAST_INSTRUCTIONS)
      expect(TOOL_ROUND_PROGRESS_INSTRUCTIONS).not.toMatch(/budget/i)
    })
})

describe('withToolBudgetPart', () => {
  it('writes the budget part right before finish', async () => {
    const output = await collect([
      { type: 'start' },
      { type: 'finish' },
    ], () => DATA)

    expect(output).toEqual([
      { type: 'start' },
      { type: 'data-tool-budget', id: 'tool-budget-1', data: DATA },
      { type: 'finish' },
    ])
  })

  it('tells the decision about an error on the way', async () => {
    const decide = vi.fn(() => null)
    const output = await collect([
      { type: 'error', errorText: 'boom' },
      { type: 'finish' },
    ], decide)

    expect(decide).toHaveBeenCalledWith(true)
    expect(output.map(chunk => chunk.type)).toEqual(['error', 'finish'])
  })
})
