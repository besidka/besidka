import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CATALOG_FOOTER,
  CONNECTOR_PRESETS,
  CONNECTOR_SIGN_IN_UNAVAILABLE_HOSTS,
  findConnectorPreset,
  findConnectorPresetByHost,
  findConnectorPresetByUrl,
  isConnectorSignInUnavailable,
} from '~~/config/connectors-catalog'
import { CONNECTOR_SLUG_PATTERN } from '#shared/utils/connectors-policy'

describe('connector catalog', () => {
  it('lists the curated presets, the four originals first', () => {
    expect(CONNECTOR_PRESETS.map(preset => preset.id)).toEqual([
      'github',
      'notion',
      'linear',
      'atlassian',
      'stripe',
      'vercel',
      'supabase',
      'sentry',
      'square',
      'intercom',
      'clickup',
      'miro',
      'todoist',
      'webflow',
      'wix',
      'cloudflare',
    ])
  })

  it('uses unique ids that are valid slugs', () => {
    const ids = CONNECTOR_PRESETS.map(preset => preset.id)

    expect(new Set(ids).size).toBe(ids.length)

    for (const id of ids) {
      expect(id).toMatch(CONNECTOR_SLUG_PATTERN)
    }
  })

  it('uses unique https URLs without credentials, queries or referrals', () => {
    const urls = CONNECTOR_PRESETS.map(preset => preset.url)

    expect(new Set(urls).size).toBe(urls.length)

    for (const value of urls) {
      const url = new URL(value)

      expect(url.protocol).toBe('https:')
      expect(url.username).toBe('')
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
      expect(value).not.toMatch(/\$\{|\{\w+\}/)
    }
  })

  it('has no logo, icon or image field', () => {
    for (const preset of CONNECTOR_PRESETS) {
      expect(Object.keys(preset).sort()).toEqual([
        'auth',
        'headerName',
        'id',
        'notice',
        'title',
        'url',
      ])
    }
  })

  it('makes GitHub header-only and Atlassian use the v2 URL', () => {
    expect(findConnectorPreset('github')?.auth).toEqual(['header'])
    expect(findConnectorPreset('atlassian')?.url)
      .toBe('https://mcp.atlassian.com/v2/mcp')
  })

  it('names a header for every preset that accepts one', () => {
    for (const preset of CONNECTOR_PRESETS) {
      const accepts = (preset.auth as readonly string[]).includes('header')

      expect(preset.headerName !== null).toBe(accepts)
    }
  })

  it('carries the required notices', () => {
    expect(findConnectorPreset('atlassian')?.notice)
      .toContain('Atlassian admin must allow besidka.com')
    expect(findConnectorPreset('github')?.notice)
      .toContain('fine-grained personal access token')
    expect(findConnectorPreset('linear')?.notice).toBeNull()
  })

  it('matches a preset by its address only, a trailing slash aside', () => {
    expect(findConnectorPresetByUrl('https://mcp.linear.app/mcp')?.id)
      .toBe('linear')
    expect(findConnectorPresetByUrl('https://mcp.linear.app/mcp/')?.id)
      .toBe('linear')
    expect(findConnectorPresetByUrl('https://mcp.linear.app/mcp/other'))
      .toBeUndefined()
    expect(findConnectorPresetByUrl('https://mcp.linear.app.evil.com/mcp'))
      .toBeUndefined()
  })

  it('says the names belong to their owners', () => {
    expect(CONNECTOR_CATALOG_FOOTER)
      .toBe('Names belong to their owners. Besidka is not affiliated with them.')
  })

  it('finds a preset by URL whatever the host case or trailing slash', () => {
    expect(findConnectorPresetByUrl('https://mcp.stripe.com')?.id)
      .toBe('stripe')
    expect(findConnectorPresetByUrl('https://MCP.notion.com/mcp/')?.id)
      .toBe('notion')
    expect(findConnectorPresetByUrl('https://mcp.notion.com/mcp?x=1'))
      .toBeUndefined()
    expect(findConnectorPresetByUrl('not a url')).toBeUndefined()
  })

  it('has the Cloudflare API server as OAuth or a bearer API token', () => {
    const preset = findConnectorPreset('cloudflare')

    expect(preset?.url).toBe('https://mcp.cloudflare.com/mcp')
    expect(preset?.auth).toEqual(['oauth', 'header'])
    expect(preset?.headerName).toBe('Authorization')
  })

  it('takes an Intercom API token only, because its sign-in refuses Besidka', () => {
    const preset = findConnectorPreset('intercom')

    expect(preset?.auth).toEqual(['header'])
    expect(preset?.headerName).toBe('Authorization')
  })

  describe('isConnectorSignInUnavailable', () => {
    it('flags the servers whose sign-in refuses Besidka', () => {
      expect(isConnectorSignInUnavailable('mcp.vercel.com')).toBe(true)
      expect(isConnectorSignInUnavailable('MCP.Squareup.com:443')).toBe(true)
      expect(isConnectorSignInUnavailable('mcp.circleci.com')).toBe(true)
      expect(isConnectorSignInUnavailable('mcp.figma.com')).toBe(true)
    })

    it('does not flag other hosts or look-alikes', () => {
      expect(isConnectorSignInUnavailable('mcp.linear.app')).toBe(false)
      expect(isConnectorSignInUnavailable('mcp.vercel.com.evil.com'))
        .toBe(false)
      expect(isConnectorSignInUnavailable('evil-mcp.vercel.com')).toBe(false)
      expect(isConnectorSignInUnavailable('')).toBe(false)
    })

    it('keeps every flagged host out of the presets that take a token', () => {
      for (const host of CONNECTOR_SIGN_IN_UNAVAILABLE_HOSTS) {
        const preset = CONNECTOR_PRESETS.find((candidate) => {
          return new URL(candidate.url).host === host
        })

        if (preset) {
          expect(preset.auth).toEqual(['oauth'])
        }
      }
    })
  })

  describe('findConnectorPresetByHost', () => {
    it('matches the exact host of a preset', () => {
      expect(findConnectorPresetByHost('mcp.cloudflare.com')?.id)
        .toBe('cloudflare')
      expect(findConnectorPresetByHost('MCP.Linear.app:443')?.id)
        .toBe('linear')
      expect(findConnectorPresetByHost('api.githubcopilot.com')?.id)
        .toBe('github')
    })

    it('matches a subdomain of a preset registrable domain', () => {
      expect(findConnectorPresetByHost('docs.mcp.cloudflare.com')?.id)
        .toBe('cloudflare')
      expect(findConnectorPresetByHost('bindings.mcp.cloudflare.com')?.id)
        .toBe('cloudflare')
      expect(findConnectorPresetByHost('mcp.eu.intercom.com')?.id)
        .toBe('intercom')
    })

    it('matches on a dot boundary only', () => {
      expect(findConnectorPresetByHost('cloudflare.com.evil.com'))
        .toBeUndefined()
      expect(findConnectorPresetByHost('evilcloudflare.com'))
        .toBeUndefined()
      expect(findConnectorPresetByHost('mcp.notcloudflare.com'))
        .toBeUndefined()
    })

    it('matches nothing for an unknown or malformed host', () => {
      expect(findConnectorPresetByHost('mcp.example.com')).toBeUndefined()
      expect(findConnectorPresetByHost('localhost')).toBeUndefined()
      expect(findConnectorPresetByHost('')).toBeUndefined()
    })
  })
})
