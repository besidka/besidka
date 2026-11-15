import { describe, expect, it } from 'vitest'
import {
  TOOL_APPROVAL_READ_SOURCES_MAX,
  TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH,
  TOOL_APPROVAL_READ_SOURCE_OVERFLOW,
  TOOL_APPROVAL_TAINT_KINDS,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolApprovalTaintKind,
} from '#shared/utils/tool-approval-policy'
import { resolveToolApproval } from '~~/server/utils/tool-approval/policy'
import {
  connectorReadSource,
  createApprovalState,
  deserializeApprovalState,
  incrementCounter,
  recordRead,
  recordTaint,
  recordToolRead,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'

describe('approval state', () => {
  it('starts empty', () => {
    const state = createApprovalState()

    expect(state.taint.size).toBe(0)
    expect(state.readSources.size).toBe(0)
    expect(state.counters).toEqual({
      rounds: 0,
      steps: 0,
      connectorCalls: 0,
      builtInCalls: 0,
    })
  })

  it('records taint and reads once each', () => {
    const state = createApprovalState()

    recordTaint(state, 'web')
    recordTaint(state, 'web')
    recordRead(state, 'besidka')
    recordRead(state, 'besidka')

    expect([...state.taint]).toEqual(['web'])
    expect([...state.readSources]).toEqual(['besidka'])
  })

  it('increments counters by one or by an amount', () => {
    const state = createApprovalState()

    incrementCounter(state, 'steps')
    incrementCounter(state, 'steps')
    incrementCounter(state, 'connectorCalls', 3)

    expect(state.counters.steps).toBe(2)
    expect(state.counters.connectorCalls).toBe(3)
  })

  it('names a connector read source by connector id', () => {
    expect(connectorReadSource('abc')).toBe('connector:abc')
  })

  it('round-trips through serialization', () => {
    const state = createApprovalState()

    recordTaint(state, 'skill')
    recordTaint(state, 'web')
    recordRead(state, connectorReadSource('b'))
    recordRead(state, 'besidka')
    incrementCounter(state, 'rounds', 2)
    incrementCounter(state, 'builtInCalls', 4)

    const restored = deserializeApprovalState(
      JSON.parse(JSON.stringify(serializeApprovalState(state))),
    )

    expect(restored).toEqual({ ok: true, state })
    expect(restored.ok && restored.state).not.toBe(state)
  })

  it('round-trips every taint kind', () => {
    const state = createApprovalState()

    for (const kind of TOOL_APPROVAL_TAINT_KINDS) {
      recordTaint(state, kind)
    }

    const serialized = serializeApprovalState(state)

    expect(serialized.taint).toEqual([...TOOL_APPROVAL_TAINT_KINDS])
    expect(deserializeApprovalState(serialized)).toEqual({ ok: true, state })
  })

  it('serializes in a stable order', () => {
    const first = createApprovalState()
    const second = createApprovalState()

    recordTaint(first, 'web')
    recordTaint(first, 'skill')
    recordRead(first, 'b')
    recordRead(first, 'a')
    recordTaint(second, 'skill')
    recordTaint(second, 'web')
    recordRead(second, 'a')
    recordRead(second, 'b')

    expect(JSON.stringify(serializeApprovalState(first)))
      .toBe(JSON.stringify(serializeApprovalState(second)))
  })

  it('does not share counters with the serialized copy', () => {
    const state = createApprovalState()
    const serialized = serializeApprovalState(state)

    incrementCounter(state, 'rounds')

    expect(serialized.counters.rounds).toBe(0)
  })

  it.each([
    ['null', null],
    ['a string', 'taint'],
    ['an unknown taint kind', {
      taint: ['made-up'],
      readSources: [],
      counters: { rounds: 0, steps: 0, connectorCalls: 0, builtInCalls: 0 },
    }],
    ['a negative counter', {
      taint: [],
      readSources: [],
      counters: { rounds: -1, steps: 0, connectorCalls: 0, builtInCalls: 0 },
    }],
    ['a missing counter', {
      taint: [],
      readSources: [],
      counters: { rounds: 0, steps: 0, connectorCalls: 0 },
    }],
    ['an empty read source', {
      taint: [],
      readSources: [''],
      counters: { rounds: 0, steps: 0, connectorCalls: 0, builtInCalls: 0 },
    }],
    ['too many read sources', {
      taint: [],
      readSources: Array.from({ length: 65 }, (_value, index) => `s${index}`),
      counters: { rounds: 0, steps: 0, connectorCalls: 0, builtInCalls: 0 },
    }],
  ])('rejects %s', (_name, value) => {
    expect(deserializeApprovalState(value)).toEqual({ ok: false })
  })

  it('never returns a fresh state for a value that fails', () => {
    const result = deserializeApprovalState({ taint: ['made-up'] })

    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('state')
  })
})

describe('approval state input validation', () => {
  it.each([
    ['an unknown kind', 'made-up'],
    ['an empty kind', ''],
    ['a non-string kind', 7],
    ['undefined', undefined],
  ])('recordTaint throws on %s', (_name, kind) => {
    const state = createApprovalState()

    expect(() => recordTaint(state, kind as ToolApprovalTaintKind))
      .toThrow('Invalid approval taint')
    expect(state.taint.size).toBe(0)
  })

  it.each([
    ['an empty source', ''],
    ['a source over the length limit',
      'x'.repeat(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH + 1)],
    ['a non-string source', 3],
    ['undefined', undefined],
  ])('recordRead throws on %s', (_name, source) => {
    const state = createApprovalState()

    expect(() => recordRead(state, source as string))
      .toThrow('Invalid approval read source')
    expect(state.readSources.size).toBe(0)
  })

  it('recordRead accepts a source of exactly the length limit', () => {
    const state = createApprovalState()
    const source = 'x'.repeat(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH)

    recordRead(state, source)

    expect(state.readSources.has(source)).toBe(true)
  })

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('incrementCounter throws on a %s amount', (_name, amount) => {
    const state = createApprovalState()

    expect(() => incrementCounter(state, 'rounds', amount))
      .toThrow('Invalid approval counter amount')
    expect(state.counters.rounds).toBe(0)
  })

  it('clamps a counter at the schema maximum so it still serializes', () => {
    const state = createApprovalState()

    incrementCounter(state, 'steps', 9_999)
    incrementCounter(state, 'steps', 5)
    incrementCounter(state, 'steps', 1_000_000)

    expect(state.counters.steps).toBe(10_000)
    expect(deserializeApprovalState(serializeApprovalState(state)).ok)
      .toBe(true)
  })

  it('serializeApprovalState throws on a taint kind it does not know', () => {
    const state = createApprovalState()

    recordTaint(state, 'web')
    state.taint.add('made-up' as ToolApprovalTaintKind)

    expect(() => serializeApprovalState(state))
      .toThrow('Invalid approval taint')
  })

  it('serializeApprovalState keeps the taint order of the constant', () => {
    const state = createApprovalState()

    for (const kind of [...TOOL_APPROVAL_TAINT_KINDS].reverse()) {
      recordTaint(state, kind)
    }

    expect(serializeApprovalState(state).taint)
      .toEqual([...TOOL_APPROVAL_TAINT_KINDS])
  })
})

describe('read sources past the cap', () => {
  function fullState() {
    const state = createApprovalState()

    for (let index = 0; index < TOOL_APPROVAL_READ_SOURCES_MAX; index++) {
      recordRead(state, connectorReadSource(`c${index}`))
    }

    return state
  }

  it('keeps every source up to the cap', () => {
    const state = fullState()

    expect(state.readSources.size).toBe(TOOL_APPROVAL_READ_SOURCES_MAX)
    expect(state.readSources.has(TOOL_APPROVAL_READ_SOURCE_OVERFLOW))
      .toBe(false)
  })

  it('collapses to the overflow sentinel instead of dropping a read', () => {
    const state = fullState()

    recordRead(state, connectorReadSource('one-more'))

    expect([...state.readSources]).toEqual([TOOL_APPROVAL_READ_SOURCE_OVERFLOW])
  })

  it('does not collapse for a source that is already recorded', () => {
    const state = fullState()

    recordRead(state, connectorReadSource('c0'))

    expect(state.readSources.size).toBe(TOOL_APPROVAL_READ_SOURCES_MAX)
  })

  it('stays collapsed and ignores later reads', () => {
    const state = fullState()

    recordRead(state, 'besidka')
    recordRead(state, connectorReadSource('later'))

    expect([...state.readSources]).toEqual([TOOL_APPROVAL_READ_SOURCE_OVERFLOW])
  })

  it('uses a sentinel that is no connector or Besidka source', () => {
    expect(TOOL_APPROVAL_READ_SOURCE_OVERFLOW).not.toBe('besidka')
    expect(TOOL_APPROVAL_READ_SOURCE_OVERFLOW.startsWith('connector:'))
      .toBe(false)
  })

  it('serializes and restores the collapsed state', () => {
    const state = fullState()

    recordRead(state, 'besidka')

    expect(deserializeApprovalState(
      JSON.parse(JSON.stringify(serializeApprovalState(state))),
    )).toEqual({ ok: true, state })
  })

  it('makes every connector call ask cross-source, even one to its own source', () => {
    const state = fullState()

    recordRead(state, 'besidka')

    const decision = resolveToolApproval({
      descriptor: {
        family: 'connector',
        access: 'read',
        toolName: 'search',
        connectorId: 'c0',
        definitionHash: 'a'.repeat(64),
        destructiveHint: false,
      },
      state,
      permissionMode: 'ask',
    })

    expect(decision.rule).toBe(3)
    expect(decision.reason).toBe('cross-source')
  })
})

describe('recordToolRead', () => {
  it('counts a tool read for rule 3 and marks it apart from preset reads',
    () => {
      const state = createApprovalState()

      recordRead(state, 'besidka')

      expect([...state.toolReadSources]).toEqual([])

      recordToolRead(state, connectorReadSource('c1'))

      expect([...state.readSources]).toEqual(['besidka', 'connector:c1'])
      expect([...state.toolReadSources]).toEqual(['connector:c1'])

      const restored = deserializeApprovalState(serializeApprovalState(state))

      expect(restored.ok && [...restored.state.toolReadSources])
        .toEqual(['connector:c1'])
    })

  it('reads a turn record written before tool reads were tracked', () => {
    const restored = deserializeApprovalState({
      taint: ['web'],
      readSources: ['besidka'],
      counters: { rounds: 1, steps: 1, connectorCalls: 0, builtInCalls: 0 },
    })

    expect(restored.ok && [...restored.state.toolReadSources]).toEqual([])
  })
})
