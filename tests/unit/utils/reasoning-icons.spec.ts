import { describe, expect, it } from 'vitest'
import {
  getReasoningLevelIconComponent,
  REASONING_AUTO_HIDE_ICON,
  REASONING_EXPANDED_ICON,
  REASONING_SECTION_ICON_COMPONENT,
} from '../../../app/utils/reasoning-icons'

describe('reasoning icons', () => {
  it('maps each level to its Svgo think component', () => {
    expect(getReasoningLevelIconComponent('off')).toBe('SvgoThinkOff')
    expect(getReasoningLevelIconComponent('low')).toBe('SvgoThinkLow')
    expect(getReasoningLevelIconComponent('medium')).toBe('SvgoThinkMedium')
    expect(getReasoningLevelIconComponent('high')).toBe('SvgoThinkHigh')
  })

  it('shares one set of names between the menu and the preferences page',
    () => {
      expect(REASONING_SECTION_ICON_COMPONENT).toBe('SvgoThinkHigh')
      expect(REASONING_EXPANDED_ICON).toBe('lucide:list-tree')
      expect(REASONING_AUTO_HIDE_ICON).toBe('lucide:timer-reset')
    })
})
