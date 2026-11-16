import { describe, expect, it } from 'vitest'
import {
  getGroupModeChanges,
  getGroupSelectableModes,
  getToolGroupMode,
} from '~/utils/tool-permissions'

const ALL_MODES = ['blocked', 'ask', 'allow'] as const
const LOCKED_MODES = ['blocked', 'ask'] as const

describe('tool permission groups', () => {
  it('reads the shared mode of a group or custom', () => {
    expect(getToolGroupMode(['allow', 'allow'])).toBe('allow')
    expect(getToolGroupMode(['ask', 'blocked'])).toBe('custom')
    expect(getToolGroupMode([])).toBe('ask')
  })

  it('offers the modes at least one tool takes, in select order', () => {
    expect(getGroupSelectableModes([{ modes: LOCKED_MODES }]))
      .toEqual(['blocked', 'ask'])
    expect(getGroupSelectableModes([
      { modes: LOCKED_MODES },
      { modes: ['allow', 'ask'] },
    ])).toEqual(['blocked', 'ask', 'allow'])
  })

  it('changes only tools that take the mode and do not have it', () => {
    expect(getGroupModeChanges([
      { name: 'a', title: 'a', mode: 'ask', modes: ALL_MODES },
      { name: 'b', title: 'b', mode: 'allow', modes: ALL_MODES },
      { name: 'c', title: 'c', mode: 'ask', modes: LOCKED_MODES },
    ], 'allow')).toEqual([{ name: 'a', mode: 'allow' }])
  })
})
