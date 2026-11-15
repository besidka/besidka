import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'

describe('besidka-tools feature flag', () => {
  it('is an available internal opt-in flag with no spend and no parent', () => {
    expect(FEATURE_REGISTRY['besidka-tools']).toEqual(expect.objectContaining({
      key: 'besidka-tools',
      stage: 'internal',
      available: true,
      default: false,
      allowRoles: ['admin'],
      spend: 'none',
      optIn: 'required',
      exposeToClient: true,
    }))
    expect(FEATURE_REGISTRY['besidka-tools'].parent).toBeUndefined()
    expect(FEATURE_REGISTRY['besidka-tools'].variants).toBeUndefined()
    expect(FEATURE_REGISTRY['besidka-tools'].description).toBe(
      'Let the model use your Besidka data and tools in chats, '
      + 'with your permission for each tool.',
    )
  })
})
