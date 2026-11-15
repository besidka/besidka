import { describe, expect, it } from 'vitest'
import {
  connectorReadSource,
  createApprovalState,
  deserializeApprovalState,
  incrementCounter,
  recordRead,
  recordTaint,
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

    expect(restored).toEqual(state)
    expect(restored).not.toBe(state)
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
    expect(deserializeApprovalState(value)).toBeNull()
  })
})
