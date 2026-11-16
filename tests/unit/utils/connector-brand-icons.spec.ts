import { describe, expect, it } from 'vitest'
import { CONNECTOR_PRESETS } from '../../../config/connectors-catalog'
import { getConnectorBrandIcon } from '../../../app/utils/connector-brand-icons'

describe('getConnectorBrandIcon', () => {
  it('has a bundled simple-icons mark for every curated preset', () => {
    for (const preset of CONNECTOR_PRESETS) {
      expect(getConnectorBrandIcon(preset.id))
        .toBe(`simple-icons:${preset.id}`)
    }
  })

  it('has nothing for an unknown, empty or inherited id', () => {
    expect(getConnectorBrandIcon('sentry')).toBeNull()
    expect(getConnectorBrandIcon(null)).toBeNull()
    expect(getConnectorBrandIcon(undefined)).toBeNull()
    expect(getConnectorBrandIcon('constructor')).toBeNull()
  })
})
