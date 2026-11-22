import { describe, expect, it } from 'vitest'
import {
  allocateConnectorSlug,
  deriveConnectorSlugBase,
  deriveConnectorSlugBaseFromTitle,
  isValidConnectorSlug,
} from '#shared/utils/connectors-slug'

describe('deriveConnectorSlugBase', () => {
  it.each([
    ['mcp.notion.com', 'notion'],
    ['mcp.linear.app', 'linear'],
    ['api.githubcopilot.com', 'githubcopilot'],
    ['mcp.example.co.uk', 'example'],
    ['example.com', 'example'],
    ['mcp.abc.com', 'abc'],
    ['mcp.exa.ai', 'exa'],
    ['api.exa.ai', 'exa'],
    ['remote.gateway.example.org', 'example'],
    ['app.com', 'app'],
    ['mcp.example.com.au', 'example'],
    ['xn--bcher-kva.example', 'xn--bcher-kva'],
    ['api.a-very-long-company-name.com', 'a-very-long-comp'],
  ])('derives %s as %s', (hostname, expected) => {
    expect(deriveConnectorSlugBase(hostname)).toBe(expected)
  })

  it('always returns a valid slug', () => {
    for (const hostname of [
      'x.io',
      'mcp.-.com',
      'a_b.example.com',
      'single',
      '',
      '---.example',
    ]) {
      expect(isValidConnectorSlug(deriveConnectorSlugBase(hostname)))
        .toBe(true)
    }
  })
})

describe('allocateConnectorSlug', () => {
  it('returns the base when it is free', () => {
    expect(allocateConnectorSlug('notion', new Set())).toBe('notion')
  })

  it('numbers collisions from 2', () => {
    expect(allocateConnectorSlug('notion', new Set(['notion'])))
      .toBe('notion-2')
    expect(allocateConnectorSlug('notion', new Set(['notion', 'notion-2'])))
      .toBe('notion-3')
  })

  it('keeps a suffixed slug within 16 characters', () => {
    const base = 'abcdefghijklmnop'
    const slug = allocateConnectorSlug(base, new Set([base]))

    expect(slug).toBe('abcdefghijklmn-2')
    expect(slug).toHaveLength(16)
    expect(isValidConnectorSlug(slug)).toBe(true)
  })

  it('does not leave a trailing dash when the cut ends on a dash', () => {
    const slug = allocateConnectorSlug('abcdefghijkl-nop', new Set([
      'abcdefghijkl-nop',
    ]))

    expect(isValidConnectorSlug(slug)).toBe(true)
    expect(slug).toBe('abcdefghijkl-n-2')
  })
})

describe('isValidConnectorSlug', () => {
  it.each(['a', 'github', 'my-server', 'a'.repeat(16)])('accepts %s', (slug) => {
    expect(isValidConnectorSlug(slug)).toBe(true)
  })

  it.each(['', '-a', 'a-', 'A', 'a_b', 'a'.repeat(17), 'a b'])(
    'rejects %j',
    (slug) => {
      expect(isValidConnectorSlug(slug)).toBe(false)
    },
  )
})

describe('deriveConnectorSlugBaseFromTitle', () => {
  it.each([
    ['Exa', 'exa'],
    ['Exa Search', 'exa-search'],
    ['  Notion  ', 'notion'],
    ['A very long connector title here', 'a-very-long-conn'],
  ])('derives %s as %s', (title, expected) => {
    expect(deriveConnectorSlugBaseFromTitle(title)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    [null],
    [undefined],
    ['mcp.exa.ai'],
    ['!!!'],
    ['Бесідка'],
  ])('falls through for %s', (title) => {
    expect(deriveConnectorSlugBaseFromTitle(title)).toBeNull()
  })
})
