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
    expect(getConnectorBrandIcon('slack')).toBeNull()
    expect(getConnectorBrandIcon(null)).toBeNull()
    expect(getConnectorBrandIcon(undefined)).toBeNull()
    expect(getConnectorBrandIcon('constructor')).toBeNull()
  })

  it('finds the mark of a connector added by URL through its host', () => {
    expect(getConnectorBrandIcon(null, 'mcp.cloudflare.com'))
      .toBe('simple-icons:cloudflare')
    expect(getConnectorBrandIcon(null, 'docs.mcp.cloudflare.com'))
      .toBe('simple-icons:cloudflare')
    expect(getConnectorBrandIcon(undefined, 'mcp.linear.app'))
      .toBe('simple-icons:linear')
  })

  it('prefers the preset id and ignores a host that matches nothing', () => {
    expect(getConnectorBrandIcon('notion', 'mcp.cloudflare.com'))
      .toBe('simple-icons:notion')
    expect(getConnectorBrandIcon(null, 'cloudflare.com.evil.com')).toBeNull()
    expect(getConnectorBrandIcon(null, 'mcp.example.com')).toBeNull()
    expect(getConnectorBrandIcon(null, null)).toBeNull()
  })
})
