import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CATALOG_FOOTER,
  CONNECTOR_PRESETS,
  findConnectorPreset,
  findConnectorPresetByUrl,
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
})
