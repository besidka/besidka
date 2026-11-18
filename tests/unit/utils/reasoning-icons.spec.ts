import { describe, expect, it } from 'vitest'
import {
  getReasoningLevelIconComponent,
  REASONING_SECTION_ICON_COMPONENT,
  STEPS_AUTO_HIDE_ICON,
  STEPS_EXPANDED_ICON,
  STEPS_SECTION_ICON,
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
      expect(STEPS_SECTION_ICON).toBe('lucide:list-checks')
      expect(STEPS_EXPANDED_ICON).toBe('lucide:list-tree')
      expect(STEPS_AUTO_HIDE_ICON).toBe('lucide:timer-reset')
    })
})
