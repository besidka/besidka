import { describe, expect, it, vi } from 'vitest'
import type { ReasoningStep } from '~/types/reasoning-step.d'
import * as reasoningUtils from '~/utils/reasoning'
import {
  createReasoningSectionsCache,
  isSameRenderModel,
  reuseStableReasoningSteps,
} from '~/utils/reasoning-steps'

function step(
  id: string,
  overrides: Partial<ReasoningStep> = {},
): ReasoningStep {
  return {
    id,
    title: `Step ${id}`,
    body: '',
    kind: 'tool',
    pending: false,
    failed: false,
    search: null,
    memory: null,
    skill: null,
    connector: null,
    ...overrides,
  }
}

describe('isSameRenderModel', () => {
  it('compares nested plain values and arrays', () => {
    expect(isSameRenderModel(
      { icon: { kind: 'connector', id: 'a' }, options: ['once', 'chat'] },
      { icon: { kind: 'connector', id: 'a' }, options: ['once', 'chat'] },
    )).toBe(true)
    expect(isSameRenderModel(
      { options: ['once', 'chat'] },
      { options: ['once'] },
    )).toBe(false)
    expect(isSameRenderModel({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(isSameRenderModel([1], { 0: 1 })).toBe(false)
  })

  it('treats the same nested object as equal without walking it', () => {
    const input = { query: 'roadmap' }

    expect(isSameRenderModel({ input }, { input })).toBe(true)
    expect(isSameRenderModel({ input }, { input: { query: 'other' } }))
      .toBe(false)
  })

  it('stops at the depth limit', () => {
    expect(isSameRenderModel({ a: { b: 1 } }, { a: { b: 1 } }, 1))
      .toBe(false)
  })
})

describe('reuseStableReasoningSteps', () => {
  it('keeps the previous object of every unchanged step', () => {
    const input = { query: 'roadmap' }
    const previous = [
      step('a', { connector: { input } as never }),
      step('b', { pending: true }),
    ]
    const next = [
      step('a', { connector: { input } as never }),
      step('b', { pending: false }),
    ]
    const result = reuseStableReasoningSteps(previous, next)

    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(next[1])
    expect(result).not.toBe(previous)
  })

  it('returns the previous array when no step changed', () => {
    const previous = [step('a'), step('b')]

    expect(reuseStableReasoningSteps(previous, [step('a'), step('b')]))
      .toBe(previous)
  })

  it('returns a new array when a step was added or moved', () => {
    const previous = [step('a'), step('b')]
    const added = reuseStableReasoningSteps(previous, [
      step('a'),
      step('b'),
      step('c'),
    ])
    const moved = reuseStableReasoningSteps(previous, [step('b'), step('a')])

    expect(added).not.toBe(previous)
    expect(added[0]).toBe(previous[0])
    expect(moved).not.toBe(previous)
    expect(moved).toEqual([previous[1], previous[0]])
  })
})

describe('createReasoningSectionsCache', () => {
  it('parses a text once and drops texts not read since the last commit',
    () => {
      const parse = vi.spyOn(reasoningUtils, 'parseReasoningSections')
      const cache = createReasoningSectionsCache()
      const text = '**Title**\n\nBody text.'

      const first = cache.parse(text)

      cache.commit()

      expect(cache.parse(text)).toBe(first)

      cache.commit()
      cache.commit()

      expect(cache.parse(text)).not.toBe(first)
      expect(cache.parse(text)).toEqual(first)
      expect(parse).toHaveBeenCalledTimes(2)

      parse.mockRestore()
    })
})
