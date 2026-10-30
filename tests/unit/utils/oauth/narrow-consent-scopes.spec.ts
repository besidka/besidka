import { describe, expect, it } from 'vitest'
import { narrowConsentScopes } from '~~/server/utils/oauth/narrow-consent-scopes'

const CONSENT = [
  'openid',
  'offline_access',
  'chats:read',
  'chats:write',
  'data:delete',
]

describe('narrowConsentScopes', () => {
  it('keeps identity scopes and the requested resource scopes', () => {
    expect(narrowConsentScopes(CONSENT, ['chats:read'])).toEqual({
      status: 'ok',
      scopes: ['openid', 'offline_access', 'chats:read'],
      removedScopes: ['chats:write', 'data:delete'],
    })
  })

  it('stores the scopes in the canonical order', () => {
    expect(narrowConsentScopes(
      ['data:delete', 'chats:write', 'chats:read', 'openid'],
      ['chats:write', 'chats:read'],
    )).toMatchObject({
      scopes: ['openid', 'chats:read', 'chats:write'],
    })
  })

  it('removes every resource scope when none is kept', () => {
    expect(narrowConsentScopes(CONSENT, [])).toEqual({
      status: 'ok',
      scopes: ['openid', 'offline_access'],
      removedScopes: ['chats:read', 'chats:write', 'data:delete'],
    })
  })

  it('reports nothing removed for an unchanged request', () => {
    expect(narrowConsentScopes(CONSENT, [
      'chats:read',
      'chats:write',
      'data:delete',
    ])).toMatchObject({ status: 'ok', removedScopes: [] })
  })

  it('ignores identity scopes in the request', () => {
    expect(narrowConsentScopes(CONSENT, ['email', 'chats:read']))
      .toMatchObject({ status: 'ok', scopes: [
        'openid',
        'offline_access',
        'chats:read',
      ] })
  })

  it('refuses a resource scope the consent does not hold', () => {
    expect(narrowConsentScopes(CONSENT, ['chats:read', 'memory:write']))
      .toEqual({ status: 'addition', scopes: ['memory:write'] })
  })

  it('refuses a scope Besidka does not define', () => {
    expect(narrowConsentScopes(CONSENT, ['admin']))
      .toEqual({ status: 'unknown', scopes: ['admin'] })
  })

  it('never returns an empty scope list', () => {
    expect(narrowConsentScopes(['chats:read'], [])).toEqual({
      status: 'empty',
    })
    expect(narrowConsentScopes([], [])).toEqual({ status: 'empty' })
  })

  it('cannot add anything to an unreadable consent', () => {
    expect(narrowConsentScopes([], ['chats:read']))
      .toEqual({ status: 'addition', scopes: ['chats:read'] })
  })
})
