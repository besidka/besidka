import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveServerLogger } from '../../../server/utils/files/logger'
import { exceptionMessage } from '../../../server/utils/evlog-attributes'

const mocks = vi.hoisted(() => ({
  revokeUserOAuthGrants: vi.fn(async () => true),
  notifyOAuthAppConnected: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
  purgeUserData: vi.fn(async () => undefined),
  purgeUserOAuthData: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/account/security-emails', () => ({
  sendPasswordChangedEmail: mocks.sendPasswordChangedEmail,
}))

vi.mock('~~/server/utils/account/revoke-user-oauth-grants', () => ({
  revokeUserOAuthGrants: mocks.revokeUserOAuthGrants,
}))

vi.mock('~~/server/utils/account/notify-oauth-app-connected', () => ({
  notifyOAuthAppConnected: mocks.notifyOAuthAppConnected,
}))

vi.mock('~~/server/utils/account/purge-user-data', () => ({
  purgeUserData: mocks.purgeUserData,
  purgeUserOAuthData: mocks.purgeUserOAuthData,
}))

vi.mock('~~/server/utils/analytics/activation', () => ({
  recordSignupActivation: vi.fn(),
  resolveSignupUtm: vi.fn(async () => ({})),
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

describe('auth hardening for the OAuth authorization server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables the plugin endpoints Besidka does not use', async () => {
    const options = await importAuthOptions()

    expect(options.disabledPaths).toEqual(expect.arrayContaining([
      '/token',
      '/oauth2/get-client',
      '/oauth2/get-clients',
      '/oauth2/create-client',
      '/oauth2/update-client',
      '/oauth2/delete-client',
      '/oauth2/client/rotate-secret',
      '/oauth2/get-consent',
      '/oauth2/get-consents',
      '/oauth2/update-consent',
      '/oauth2/delete-consent',
    ]))
  })

  it('keeps the endpoints the consent and token flows need', async () => {
    const options = await importAuthOptions()

    for (const path of [
      '/oauth2/authorize',
      '/oauth2/consent',
      '/oauth2/continue',
      '/oauth2/register',
      '/oauth2/token',
      '/oauth2/revoke',
      '/oauth2/introspect',
      '/oauth2/userinfo',
      '/oauth2/end-session',
      '/oauth2/public-client',
      '/oauth2/public-client-prelogin',
    ]) {
      expect(options.disabledPaths).not.toContain(path)
    }
  })

  it('revokes every grant after a password reset', async () => {
    const options = await importAuthOptions()

    await options.emailAndPassword!.onPasswordReset!({
      user: { id: '9', email: 'user@example.com' },
    } as any)

    expect(mocks.revokeUserOAuthGrants).toHaveBeenCalledWith({
      userId: 9,
      trigger: 'reset-password',
    })
    expect(mocks.sendPasswordChangedEmail).toHaveBeenCalled()
  })

  it('revokes every grant when a password change revokes other sessions',
    async () => {
      const options = await importAuthOptions()

      await options.hooks!.after!({
        path: '/change-password',
        body: { revokeOtherSessions: true },
        context: {
          returned: { status: true },
          session: { user: { id: '9', email: 'user@example.com' } },
        },
      } as any)

      expect(mocks.revokeUserOAuthGrants).toHaveBeenCalledWith({
        userId: 9,
        trigger: 'change-password',
      })
      expect(mocks.sendPasswordChangedEmail).toHaveBeenCalled()
    })

  it('keeps grants when a password change keeps other sessions', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/change-password',
      body: { revokeOtherSessions: false },
      context: {
        returned: { status: true },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.revokeUserOAuthGrants).not.toHaveBeenCalled()
  })

  it('revokes every grant after revoking all sessions', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/revoke-sessions',
      body: {},
      context: {
        returned: { status: true },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.revokeUserOAuthGrants).toHaveBeenCalledWith({
      userId: 9,
      trigger: 'revoke-sessions',
    })
  })

  it('does not revoke grants when the endpoint failed', async () => {
    const { APIError } = await import('better-auth/api')
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/revoke-sessions',
      body: {},
      context: {
        returned: new APIError('UNAUTHORIZED'),
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.revokeUserOAuthGrants).not.toHaveBeenCalled()
  })

  it('purges OAuth data before the account content', async () => {
    const options = await importAuthOptions()
    const order: string[] = []

    mocks.purgeUserOAuthData.mockImplementationOnce(async () => {
      order.push('oauth')
    })
    mocks.purgeUserData.mockImplementationOnce(async () => {
      order.push('content')
    })

    await options.user!.deleteUser!.beforeDelete!(
      { id: '9', email: 'user@example.com' } as any,
    )

    expect(order).toEqual(['oauth', 'content'])
  })

  it('keeps the content when the OAuth purge fails', async () => {
    const options = await importAuthOptions()

    mocks.purgeUserOAuthData.mockRejectedValueOnce(new Error('d1 down'))

    await expect(options.user!.deleteUser!.beforeDelete!(
      { id: '9', email: 'user@example.com' } as any,
    )).rejects.toThrow('d1 down')
    expect(mocks.purgeUserData).not.toHaveBeenCalled()
  })

  it('emails the user when a connected app is approved', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/oauth2/consent',
      body: {
        accept: true,
        scope: 'openid chats:read',
        oauth_query: 'client_id=client-1&scope=openid+chats%3Aread&sig=x',
      },
      context: {
        returned: { redirect: true, url: 'https://claude.ai/cb' },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.notifyOAuthAppConnected).toHaveBeenCalledWith({
      user: { id: '9', email: 'user@example.com' },
      clientId: 'client-1',
      scopes: ['openid', 'chats:read'],
    })
  })

  it('does not email the user when the app is denied', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/oauth2/consent',
      body: {
        accept: false,
        oauth_query: 'client_id=client-1&sig=x',
      },
      context: {
        returned: { redirect: true, url: 'https://claude.ai/cb' },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.notifyOAuthAppConnected).not.toHaveBeenCalled()
  })

  it('rejects an oversized client registration with the OAuth error shape',
    async () => {
      const options = await importAuthOptions()

      await expect(options.hooks!.before!({
        path: '/oauth2/register',
        body: { client_name: 'x'.repeat(121) },
        context: {},
      } as any)).rejects.toMatchObject({
        body: {
          error: 'invalid_client_metadata',
          error_description: expect.stringContaining('client_name'),
        },
      })
    })

  it('rejects a registration whose declared body size is too large',
    async () => {
      const options = await importAuthOptions()

      await expect(options.hooks!.before!({
        path: '/oauth2/register',
        body: { client_name: 'Claude' },
        request: new Request('https://example.com/api/auth/oauth2/register', {
          method: 'POST',
          headers: { 'content-length': String(64 * 1024) },
        }),
        context: {},
      } as any)).rejects.toMatchObject({
        body: { error: 'invalid_client_metadata' },
      })
    })

  it('accepts a normal client registration', async () => {
    const options = await importAuthOptions()

    await expect(options.hooks!.before!({
      path: '/oauth2/register',
      body: {
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      },
      context: {},
    } as any)).resolves.not.toThrow()
  })
})
