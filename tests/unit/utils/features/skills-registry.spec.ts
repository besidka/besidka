import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'

describe('skills feature flags', () => {
  it('registers the four skills flags under the skills parent', () => {
    for (const key of [
      'skills.import-url',
      'skills.commands',
      'skills.scripts',
    ] as const) {
      expect(FEATURE_REGISTRY[key].parent).toBe('skills')
    }

    expect(FEATURE_REGISTRY.skills.parent).toBeUndefined()
  })

  it('ships skills.commands available, internal, off and without spend', () => {
    expect(FEATURE_REGISTRY['skills.commands']).toEqual(
      expect.objectContaining({
        available: true,
        stage: 'internal',
        default: false,
        allowRoles: ['admin'],
        spend: 'none',
        optIn: 'none',
      }),
    )
  })

  it('bills skills.scripts to the foreground and requires an opt-in', () => {
    expect(FEATURE_REGISTRY['skills.scripts']).toEqual(
      expect.objectContaining({
        stage: 'internal',
        default: false,
        spend: 'foreground',
        optIn: 'required',
      }),
    )
  })

  it('keeps the other skills flags free of spend', () => {
    expect(FEATURE_REGISTRY.skills.spend).toBe('none')
    expect(FEATURE_REGISTRY['skills.import-url'].spend).toBe('none')
  })
})
