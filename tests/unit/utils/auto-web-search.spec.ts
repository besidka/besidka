import { describe, expect, it } from 'vitest'
import {
  didMessageSearchTheWeb,
  getAutoWebSearchChipState,
} from '#shared/utils/auto-web-search'

describe('didMessageSearchTheWeb', () => {
  it('is false for text-only parts without search units', () => {
    expect(didMessageSearchTheWeb([{ type: 'text', text: 'Hi' }], undefined))
      .toBe(false)
  })

  it('is false for parts that are not an array', () => {
    expect(didMessageSearchTheWeb(undefined, undefined)).toBe(false)
    expect(didMessageSearchTheWeb(null, 0)).toBe(false)
  })

  it('is true for a positive search unit count', () => {
    expect(didMessageSearchTheWeb([], 1)).toBe(true)
  })

  it('is false for zero or non-numeric search units', () => {
    expect(didMessageSearchTheWeb([], 0)).toBe(false)
    expect(didMessageSearchTheWeb([], '2')).toBe(false)
  })

  it.each(['source-url', 'source-document'])('is true for a %s part', (type) => {
    expect(didMessageSearchTheWeb([{ type }], undefined)).toBe(true)
  })

  it.each([
    'tool-web_search',
    'tool-web_search_preview',
    'tool-web_search_brave',
    'tool-web_search_exa',
  ])('is true for a completed %s part', (type) => {
    expect(
      didMessageSearchTheWeb([{ type, state: 'output-available' }], undefined),
    ).toBe(true)
  })

  it.each(['input-streaming', 'input-available', 'output-error'])(
    'is false for a search tool part in the %s state',
    (state) => {
      expect(
        didMessageSearchTheWeb(
          [{ type: 'tool-web_search_exa', state }],
          undefined,
        ),
      ).toBe(false)
    },
  )

  it('ignores other tool parts and malformed parts', () => {
    expect(
      didMessageSearchTheWeb(
        [
          { type: 'tool-search_chats', state: 'output-available' },
          null,
          'text',
          {},
        ],
        undefined,
      ),
    ).toBe(false)
  })
})

describe('getAutoWebSearchChipState', () => {
  it('reports a skipped outcome regardless of the search flag', () => {
    expect(getAutoWebSearchChipState('skipped', false)).toEqual({
      label: 'Auto: no web search needed',
      icon: 'lucide:circle-slash-2',
      searched: false,
    })
  })

  it.each(['searched', 'forced', 'fallback'] as const)(
    'reports a search for the %s outcome when one ran',
    (outcome) => {
      expect(getAutoWebSearchChipState(outcome, true)).toEqual({
        label: 'Auto: searched the web',
        icon: 'lucide:globe',
        searched: true,
      })
    },
  )

  it.each(['searched', 'forced', 'fallback'] as const)(
    'reports an unused search for the %s outcome when none ran',
    (outcome) => {
      expect(getAutoWebSearchChipState(outcome, false)).toEqual({
        label: 'Auto: search allowed, not used',
        icon: 'lucide:search-x',
        searched: false,
      })
    },
  )
})
