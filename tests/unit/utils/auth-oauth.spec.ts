import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveServerLogger } from '../../../server/utils/files/logger'
import { exceptionMessage } from '../../../server/utils/evlog-attributes'

vi.mock('~~/server/utils/account/security-emails', () => ({}))

vi.mock('~~/server/utils/analytics/activation', () => ({
  recordSignupActivation: vi.fn(),
  resolveSignupUtm: vi.fn(async () => ({})),
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: vi.fn(),
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(),
}))

function stubBindings(loggerSet = vi.fn()) {
  vi.stubGlobal('useRuntimeConfig', () => ({
    betterAuthSecret: 'secret-secret-secret-secret-secret',
    public: {
      baseUrl: 'https://example.com',
      turnstileSiteKey: '',
      cookieConsent: { cookieName: 'cookies_consent', revision: 2 },
    },
    turnstileSecretKey: '',
    turnstileEnforced: false,
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
  }))
  vi.stubGlobal('useDb', () => ({}))
  vi.stubGlobal('useKV', () => ({}))
  vi.stubGlobal('getCaptchaOptions', () => null)
  vi.stubGlobal('authRateLimitDefaults', { window: 60, max: 60 })
  vi.stubGlobal('authRateLimitRules', {})
  vi.stubGlobal('createAuthRateLimitStorage', () => ({
    get: vi.fn(),
    set: vi.fn(),
    consume: vi.fn(),
  }))
  vi.stubGlobal('createAuthSecondaryStorage', () => ({
    get: vi.fn(),
    getAndDelete: vi.fn(),
    increment: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }))
  vi.stubGlobal('resolveServerLogger', loggerSet
    ? () => ({ set: loggerSet })
    : resolveServerLogger)
  vi.stubGlobal('exceptionMessage', exceptionMessage)
}

async function importAuthModule() {
  vi.resetModules()

  return import('../../../server/utils/auth')
}

async function importAuthOptions(loggerSet = vi.fn()) {
  stubBindings(loggerSet)

  const module = await importAuthModule()
  const auth = module.useServerAuth()

  await (auth as unknown as { $context: Promise<unknown> }).$context
    .catch(() => {})

  return auth.options
}

describe('stripPrivilegedClientRegistrationFields', () => {
  beforeEach(() => {
    stubBindings()
  })

  it('removes consent-skipping and logout fields in both spellings',
    async () => {
      const module = await importAuthModule()
      const body: Record<string, unknown> = {
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        skip_consent: true,
        skipConsent: true,
        enable_end_session: true,
        enableEndSession: true,
      }

      module.stripPrivilegedClientRegistrationFields(body)

      expect(body).toEqual({
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      })
    })

  it('ignores a missing body', async () => {
    const { stripPrivilegedClientRegistrationFields } = await importAuthModule()

    expect(() => stripPrivilegedClientRegistrationFields(undefined))
      .not.toThrow()
  })
})

describe('resolveOAuthConsentDecision', () => {
  const oauthQuery = new URLSearchParams({
    client_id: 'client-1',
    scope: 'openid offline_access chats:read memory:write',
    sig: 'signature',
  }).toString()

  it('records the accepted subset of scopes', async () => {
    const { resolveOAuthConsentDecision } = await importAuthModule()

    expect(resolveOAuthConsentDecision({
      accept: true,
      scope: 'openid offline_access chats:read',
      oauth_query: oauthQuery,
    })).toEqual({
      action: 'oauth_granted',
      clientId: 'client-1',
      scopes: ['openid', 'offline_access', 'chats:read'],
    })
  })

  it('falls back to every requested scope without a subset', async () => {
    const { resolveOAuthConsentDecision } = await importAuthModule()

    expect(resolveOAuthConsentDecision({
      accept: true,
      oauth_query: oauthQuery,
    }).scopes).toEqual([
      'openid',
      'offline_access',
      'chats:read',
      'memory:write',
    ])
  })

  it('records a denial without scopes', async () => {
    const { resolveOAuthConsentDecision } = await importAuthModule()

    expect(resolveOAuthConsentDecision({
      accept: false,
      oauth_query: oauthQuery,
    })).toEqual({
      action: 'oauth_denied',
      clientId: 'client-1',
      scopes: [],
    })
  })
})

describe('auth hooks for the OAuth authorization server', () => {
  it('strips privileged fields before /oauth2/register validates the body',
    async () => {
      const options = await importAuthOptions()
      const body: Record<string, unknown> = {
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        skip_consent: true,
        enable_end_session: true,
      }

      await options.hooks!.before!({
        path: '/oauth2/register',
        body,
        context: {},
      } as any)

      expect(body).toEqual({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      })
    })

  it('logs a consent grant under attributes.legalConsent', async () => {
    const loggerSet = vi.fn()
    const options = await importAuthOptions(loggerSet)

    await options.hooks!.after!({
      path: '/oauth2/consent',
      body: {
        accept: true,
        scope: 'openid chats:read',
        oauth_query: 'client_id=client-1&scope=openid+chats%3Aread&sig=x',
      },
      context: {
        returned: { redirect: true, url: 'https://claude.ai/cb?code=abc' },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(loggerSet).toHaveBeenCalledWith({
      userId: 9,
      attributes: {
        legalConsent: {
          action: 'oauth_granted',
          oauthClientId: 'client-1',
          scopes: ['openid', 'chats:read'],
        },
      },
    })
    expect(JSON.stringify(loggerSet.mock.calls)).not.toContain('code=abc')
  })
})
