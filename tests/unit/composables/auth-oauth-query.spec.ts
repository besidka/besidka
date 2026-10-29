import { describe, expect, it } from 'vitest'
import {
  appendSignedOAuthQueryToPath,
  buildOAuthAuthorizeResumePath,
  isSignedOAuthQueryExpired,
  pickSignedOAuthQuery,
  readOAuthRedirectUrl,
  signedOAuthQueryRequiresSignIn,
  signedOAuthQueryToString,
} from '../../../app/composables/auth'

const FUTURE_EXP = '4102444800'
const PAST_EXP = '946684800'

function signedRouteQuery(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'client-1',
    scope: 'openid chats:read',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    resource: 'https://besidka.com/mcp',
    exp: FUTURE_EXP,
    ba_iat: '1761750000000',
    ba_param: [
      'ba_iat',
      'ba_param',
      'client_id',
      'exp',
      'redirect_uri',
      'resource',
      'scope',
    ],
    sig: 'signature',
    ...overrides,
  }
}

describe('pickSignedOAuthQuery', () => {
  it('returns null without a signature', () => {
    expect(pickSignedOAuthQuery({ client_id: 'client-1' })).toBeNull()
  })

  it('returns null without the signed parameter list', () => {
    expect(pickSignedOAuthQuery({ sig: 'signature' })).toBeNull()
  })

  it('returns null when the signature is repeated', () => {
    expect(pickSignedOAuthQuery(signedRouteQuery({
      sig: ['one', 'two'],
    }))).toBeNull()
  })

  it('keeps only the signed parameters', () => {
    const picked = pickSignedOAuthQuery(signedRouteQuery({
      next: '/profile/keys',
      utm_source: 'reddit',
    }))

    expect(picked).not.toBeNull()
    expect(picked).not.toHaveProperty('next')
    expect(picked).not.toHaveProperty('utm_source')
    expect(picked).toMatchObject({
      sig: 'signature',
      client_id: 'client-1',
      scope: 'openid chats:read',
      exp: FUTURE_EXP,
    })
  })

  it('keeps repeated signed values', () => {
    const picked = pickSignedOAuthQuery(signedRouteQuery({
      resource: ['https://besidka.com/mcp', 'https://besidka.com/other'],
    }))

    expect(picked?.resource).toEqual([
      'https://besidka.com/mcp',
      'https://besidka.com/other',
    ])
  })
})

describe('appendSignedOAuthQueryToPath', () => {
  it('returns the path unchanged without a signed query', () => {
    expect(appendSignedOAuthQueryToPath('/2fa?next=%2Fchats%2Fnew', null))
      .toBe('/2fa?next=%2Fchats%2Fnew')
  })

  it('carries every signed parameter onto /2fa next to next', () => {
    const picked = pickSignedOAuthQuery(signedRouteQuery())!
    const path = appendSignedOAuthQueryToPath('/2fa?next=%2Fchats%2Fnew', picked)
    const url = new URL(path, 'http://localhost')

    expect(url.pathname).toBe('/2fa')
    expect(url.searchParams.get('next')).toBe('/chats/new')
    expect(url.searchParams.get('sig')).toBe('signature')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.getAll('ba_param')).toHaveLength(7)
  })

  it('round-trips through pickSignedOAuthQuery on /signup', () => {
    const picked = pickSignedOAuthQuery(signedRouteQuery())!
    const path = appendSignedOAuthQueryToPath('/signup', picked)
    const url = new URL(path, 'http://localhost')
    const query = Object.fromEntries(
      [...new Set(url.searchParams.keys())].map((key) => {
        const values = url.searchParams.getAll(key)

        return [key, values.length === 1 ? values[0] : values]
      }),
    )

    expect(pickSignedOAuthQuery(query)).toEqual(picked)
  })
})

describe('signedOAuthQueryToString', () => {
  it('serialises repeated values as repeated parameters', () => {
    const value = signedOAuthQueryToString({
      sig: 'signature',
      ba_param: ['ba_param', 'scope'],
      scope: 'openid',
    })
    const params = new URLSearchParams(value)

    expect(params.getAll('ba_param')).toEqual(['ba_param', 'scope'])
    expect(params.get('scope')).toBe('openid')
  })
})

describe('isSignedOAuthQueryExpired', () => {
  it('is false before exp', () => {
    expect(isSignedOAuthQueryExpired({ exp: FUTURE_EXP })).toBe(false)
  })

  it('is true after exp', () => {
    expect(isSignedOAuthQueryExpired({ exp: PAST_EXP })).toBe(true)
  })

  it('treats a missing exp as expired', () => {
    expect(isSignedOAuthQueryExpired({ sig: 'signature' })).toBe(true)
  })
})

describe('signedOAuthQueryRequiresSignIn', () => {
  it('requires sign-in for prompt=login', () => {
    expect(signedOAuthQueryRequiresSignIn({ prompt: 'consent login' }))
      .toBe(true)
  })

  it('requires sign-in for max_age', () => {
    expect(signedOAuthQueryRequiresSignIn({ max_age: '0' })).toBe(true)
  })

  it('does not require sign-in otherwise', () => {
    expect(signedOAuthQueryRequiresSignIn({ prompt: 'consent' }))
      .toBe(false)
  })
})

describe('buildOAuthAuthorizeResumePath', () => {
  it('drops the signature fields and targets the authorize endpoint', () => {
    const picked = pickSignedOAuthQuery(signedRouteQuery())!
    const url = new URL(
      buildOAuthAuthorizeResumePath(picked),
      'http://localhost',
    )

    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('resource')).toBe('https://besidka.com/mcp')

    for (const internal of ['sig', 'exp', 'ba_iat', 'ba_param', 'ba_pl']) {
      expect(url.searchParams.has(internal)).toBe(false)
    }
  })
})

describe('readOAuthRedirectUrl', () => {
  it('reads the redirect url of an OAuth continuation', () => {
    expect(readOAuthRedirectUrl({
      redirect: true,
      url: '/oauth/consent?sig=1',
    })).toBe('/oauth/consent?sig=1')
  })

  it.each([
    [null],
    [{ session: {}, user: {} }],
    [{ redirect: false, url: '/chats/new' }],
    [{ redirect: true, url: '' }],
  ])('returns null for %j', (data) => {
    expect(readOAuthRedirectUrl(data)).toBeNull()
  })
})
