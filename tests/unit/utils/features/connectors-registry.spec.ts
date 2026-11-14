import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'

describe('connectors feature flags', () => {
  it('registers three sub-flags under the connectors parent', () => {
    for (const key of [
      'connectors.oauth',
      'connectors.registry',
      'connectors.native',
    ] as const) {
      expect(FEATURE_REGISTRY[key].parent).toBe('connectors')
    }

    expect(FEATURE_REGISTRY.connectors.parent).toBeUndefined()
  })

  it('keeps every connectors flag internal, off and admin-only', () => {
    for (const key of [
      'connectors',
      'connectors.oauth',
      'connectors.registry',
      'connectors.native',
    ] as const) {
      expect(FEATURE_REGISTRY[key]).toEqual(expect.objectContaining({
        stage: 'internal',
        default: false,
        allowRoles: ['admin'],
        available: false,
      }))
    }
  })

  it('has no spend on the flags the remote server bills', () => {
    for (const key of [
      'connectors',
      'connectors.oauth',
      'connectors.registry',
    ] as const) {
      expect(FEATURE_REGISTRY[key].spend).toBe('none')
      expect(FEATURE_REGISTRY[key].optIn).toBe('none')
    }
  })

  it('bills connectors.native to the foreground behind an opt-in', () => {
    expect(FEATURE_REGISTRY['connectors.native']).toEqual(
      expect.objectContaining({ spend: 'foreground', optIn: 'required' }),
    )
  })
})
