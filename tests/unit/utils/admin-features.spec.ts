import { describe, expect, it } from 'vitest'
import type { AdminFeatureView } from '../../../app/utils/admin-features'
import { getAdminFeatureState } from '../../../app/utils/admin-features'

const options = { rolloutEnabled: true, hostMode: 'byok' }

function createFeature(
  overrides: Partial<AdminFeatureView> = {},
): AdminFeatureView {
  return {
    key: 'artifacts',
    available: true,
    default: false,
    allowRoles: ['admin'],
    killSwitched: false,
    rule: null,
    ...overrides,
  }
}

describe('getAdminFeatureState', () => {
  it('marks a feature whose code has not shipped as not implemented', () => {
    expect(getAdminFeatureState(createFeature({ available: false }), options))
      .toEqual({ label: 'Not implemented', tone: 'off' })
  })

  it('reports not implemented before the kill switch and host mode', () => {
    const feature = createFeature({ available: false, killSwitched: true })

    expect(getAdminFeatureState(feature, { ...options, hostMode: 'off' }))
      .toEqual({ label: 'Not implemented', tone: 'off' })
  })

  it('still reports the access state of an implemented feature', () => {
    expect(getAdminFeatureState(createFeature(), options))
      .toEqual({ label: 'Admins', tone: 'limited' })
    expect(getAdminFeatureState(createFeature({ default: true }), options))
      .toEqual({ label: 'On', tone: 'on' })
  })
})
