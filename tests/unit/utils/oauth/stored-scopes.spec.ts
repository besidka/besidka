import { describe, expect, it } from 'vitest'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

const SCOPES = ['openid', 'chats:read', 'data:delete']

describe('parseStoredOAuthScopes', () => {
  it('reads a real array', () => {
    expect(parseStoredOAuthScopes(SCOPES)).toEqual(SCOPES)
  })

  it('reads a JSON text', () => {
    expect(parseStoredOAuthScopes(JSON.stringify(SCOPES))).toEqual(SCOPES)
  })

  it('reads a double-encoded JSON text', () => {
    expect(parseStoredOAuthScopes(JSON.stringify(JSON.stringify(SCOPES))))
      .toEqual(SCOPES)
  })

  it('reads a triple-encoded JSON text', () => {
    expect(parseStoredOAuthScopes(
      JSON.stringify(JSON.stringify(JSON.stringify(SCOPES))),
    )).toEqual(SCOPES)
  })

  it('reads a space-separated string', () => {
    expect(parseStoredOAuthScopes('openid  chats:read\tdata:delete'))
      .toEqual(SCOPES)
  })

  it('reads a JSON-encoded space-separated string', () => {
    expect(parseStoredOAuthScopes(JSON.stringify('openid chats:read')))
      .toEqual(['openid', 'chats:read'])
  })

  it('de-duplicates and keeps the first-seen order', () => {
    expect(parseStoredOAuthScopes(['openid', 'chats:read', 'openid']))
      .toEqual(['openid', 'chats:read'])
    expect(parseStoredOAuthScopes('chats:read openid chats:read'))
      .toEqual(['chats:read', 'openid'])
  })

  it('drops non-string and blank entries', () => {
    expect(parseStoredOAuthScopes(['openid', 7, null, {}, '', '  ']))
      .toEqual(['openid'])
    expect(parseStoredOAuthScopes('["openid", 7, null]')).toEqual(['openid'])
  })

  it('returns an empty list for everything it cannot read', () => {
    expect(parseStoredOAuthScopes(null)).toEqual([])
    expect(parseStoredOAuthScopes(undefined)).toEqual([])
    expect(parseStoredOAuthScopes(42)).toEqual([])
    expect(parseStoredOAuthScopes({ scopes: SCOPES })).toEqual([])
    expect(parseStoredOAuthScopes('')).toEqual([])
    expect(parseStoredOAuthScopes('[]')).toEqual([])
    expect(parseStoredOAuthScopes('["openid"')).toEqual([])
    expect(parseStoredOAuthScopes('{"scopes":["openid"]}')).toEqual([])
  })

  it('returns a fresh array', () => {
    const stored = ['openid']
    const parsed = parseStoredOAuthScopes(stored)

    parsed.push('mutated')

    expect(stored).toEqual(['openid'])
  })
})
