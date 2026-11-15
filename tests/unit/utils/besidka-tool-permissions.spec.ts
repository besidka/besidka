import { describe, expect, it } from 'vitest'
import {
  BESIDKA_TOOL_NAME_PATTERN,
  getAllowedBesidkaToolModes,
  isBesidkaToolModeAllowed,
} from '#shared/utils/besidka-tool-permissions'
import { getBesidkaToolGroupMode } from '~/utils/besidka-tool-permissions'

describe('besidka tool permission modes', () => {
  it('allows all three modes for read and write tools', () => {
    expect(getAllowedBesidkaToolModes('read'))
      .toEqual(['blocked', 'ask', 'allow'])
    expect(getAllowedBesidkaToolModes('write'))
      .toEqual(['blocked', 'ask', 'allow'])
  })

  it('never allows "allow" for ask-every-time tools', () => {
    expect(getAllowedBesidkaToolModes('ask-every-time'))
      .toEqual(['blocked', 'ask'])
    expect(isBesidkaToolModeAllowed('ask-every-time', 'allow')).toBe(false)
    expect(isBesidkaToolModeAllowed('ask-every-time', 'ask')).toBe(true)
  })

  it('matches registry names and refuses prefixed or odd names', () => {
    expect(BESIDKA_TOOL_NAME_PATTERN.test('list_files')).toBe(true)
    expect(BESIDKA_TOOL_NAME_PATTERN.test('besidka__list_files')).toBe(true)
    expect(BESIDKA_TOOL_NAME_PATTERN.test('List-Files')).toBe(false)
    expect(BESIDKA_TOOL_NAME_PATTERN.test('')).toBe(false)
  })
})

describe('getBesidkaToolGroupMode', () => {
  it('returns the shared mode, custom for a mix and ask for an empty group',
    () => {
      expect(getBesidkaToolGroupMode(['allow', 'allow'])).toBe('allow')
      expect(getBesidkaToolGroupMode(['blocked'])).toBe('blocked')
      expect(getBesidkaToolGroupMode(['ask', 'allow'])).toBe('custom')
      expect(getBesidkaToolGroupMode([])).toBe('ask')
    })
})
