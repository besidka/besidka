import { describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'

describe('tool-approvals feature flag', () => {
  it('is an available internal flag for admins and granted testers', () => {
    expect(FEATURE_REGISTRY['tool-approvals']).toEqual(expect.objectContaining({
      key: 'tool-approvals',
      stage: 'internal',
      available: true,
      default: false,
      allowRoles: ['admin'],
      spend: 'none',
      optIn: 'none',
      exposeToClient: true,
    }))
    expect(FEATURE_REGISTRY['tool-approvals'].parent).toBeUndefined()
    expect(FEATURE_REGISTRY['tool-approvals'].variants).toBeUndefined()
  })
})
