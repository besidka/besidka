import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveServerLogger } from '../../../server/utils/files/logger'
import { exceptionMessage } from '../../../server/utils/evlog-attributes'

const mocks = vi.hoisted(() => ({
  revokeUserOAuthGrants: vi.fn(async () => true),
  notifyOAuthAppConnected: vi.fn(async () => undefined),
  revokeSupersededClients: vi.fn(async () => [] as Array<{
    clientId: string
    scopes: string[]
  }>),
  logInfo: vi.fn(),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
  purgeUserData: vi.fn(async () => undefined),
  purgeUserOAuthData: vi.fn(async () => undefined),
  keepMcpAdminScopesForAdmins: vi.fn(),
}))

vi.mock('~~/server/utils/mcp/admin-scopes', () => ({
  keepMcpAdminScopesForAdmins: mocks.keepMcpAdminScopesForAdmins,
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

vi.mock(
  '~~/server/utils/oauth/revoke-superseded-clients',
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import('~~/server/utils/oauth/revoke-superseded-clients')
    >()

    return {
      ...original,
      revokeSupersededClients: mocks.revokeSupersededClients,
    }
  },
)

vi.mock('evlog', async (importOriginal) => {
  const original = await importOriginal<typeof import('evlog')>()

  return { ...original, log: { ...original.log, info: mocks.logInfo } }
})

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

describe('stripMcpAdminScopesFromConsent', () => {
  const oauthQuery = 'client_id=c1&scope=openid%20chats%3Aread%20admin%3Afeatures'

  beforeEach(() => {
    stubBindings()
    mocks.keepMcpAdminScopesForAdmins.mockReset()
      .mockImplementation(async (scopes: string[]) => {
        return scopes.filter(scope => scope !== 'admin:features')
      })
  })

  it('strips the admin scope from an explicit scope for a non-admin',
    async () => {
      const { stripMcpAdminScopesFromConsent } = await importAuthModule()
      const body: Record<string, unknown> = {
        accept: true,
        scope: 'openid chats:read admin:features',
        oauth_query: oauthQuery,
      }

      await stripMcpAdminScopesFromConsent(body, async () => 7)

      expect(body.scope).toBe('openid chats:read')
      expect(mocks.keepMcpAdminScopesForAdmins).toHaveBeenCalledWith(
        ['openid', 'chats:read', 'admin:features'],
        7,
        expect.anything(),
      )
    })

  it('writes an explicit narrowed scope when the body omits scope',
    async () => {
      const { stripMcpAdminScopesFromConsent } = await importAuthModule()
      const body: Record<string, unknown> = {
        accept: true,
        oauth_query: oauthQuery,
      }

      await stripMcpAdminScopesFromConsent(body, async () => 7)

      expect(body.scope).toBe('openid chats:read')
    })

  it('keeps the admin scope for an admin', async () => {
    mocks.keepMcpAdminScopesForAdmins.mockImplementation(
      async (scopes: string[]) => scopes,
    )

    const { stripMcpAdminScopesFromConsent } = await importAuthModule()
    const body: Record<string, unknown> = {
      accept: true,
      scope: 'chats:read admin:features',
    }

    await stripMcpAdminScopesFromConsent(body, async () => 1)

    expect(body.scope).toBe('chats:read admin:features')
  })

  it('strips without a session and refuses an empty result', async () => {
    const { stripMcpAdminScopesFromConsent } = await importAuthModule()
    const body: Record<string, unknown> = {
      accept: true,
      scope: 'admin:features',
    }

    await expect(stripMcpAdminScopesFromConsent(body, async () => null))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.keepMcpAdminScopesForAdmins).not.toHaveBeenCalled()
  })

  it('ignores denials and consents without an admin scope', async () => {
    const { stripMcpAdminScopesFromConsent } = await importAuthModule()
    const resolveUserId = vi.fn(async () => 7)

    await stripMcpAdminScopesFromConsent(
      { accept: false, scope: 'admin:features' },
      resolveUserId,
    )
    await stripMcpAdminScopesFromConsent(
      { accept: true, scope: 'chats:read' },
      resolveUserId,
    )

    expect(resolveUserId).not.toHaveBeenCalled()
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

  it('upgrades a stale client scope snapshot before /oauth2/authorize',
    async () => {
      const loggerSet = vi.fn()
      const options = await importAuthOptions(loggerSet)
      const adapter = {
        findOne: vi.fn(async () => ({ scopes: ['openid', 'chats:read'] })),
        update: vi.fn(async () => ({})),
      }

      await options.hooks!.before!({
        path: '/oauth2/authorize',
        query: { client_id: 'client-1', scope: 'openid files:read' },
        context: { adapter },
      } as any)

      expect(adapter.findOne).toHaveBeenCalledTimes(1)
      expect(adapter.update).toHaveBeenCalledTimes(1)
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          oauth_client_scope_upgrade: true,
          oauth_client_scope_upgrade_added: expect.any(Number),
        },
      })
    })

  it('does not touch the database for other paths or a missing client id',
    async () => {
      const options = await importAuthOptions()
      const adapter = { findOne: vi.fn(), update: vi.fn() }

      await options.hooks!.before!({
        path: '/oauth2/token',
        query: { client_id: 'client-1' },
        context: { adapter },
      } as any)
      await options.hooks!.before!({
        path: '/oauth2/authorize',
        query: {},
        context: { adapter },
      } as any)
      await options.hooks!.before!({
        path: '/oauth2/authorize',
        context: { adapter },
      } as any)

      expect(adapter.findOne).not.toHaveBeenCalled()
      expect(adapter.update).not.toHaveBeenCalled()
    })

  it('never blocks /oauth2/authorize when the upgrade fails', async () => {
    const loggerSet = vi.fn()
    const options = await importAuthOptions(loggerSet)
    const adapter = {
      findOne: vi.fn(async () => {
        throw new Error('D1 unavailable')
      }),
      update: vi.fn(),
    }

    await expect(options.hooks!.before!({
      path: '/oauth2/authorize',
      query: { client_id: 'client-1' },
      context: { adapter },
    } as any)).resolves.toBeUndefined()

    expect(loggerSet).toHaveBeenCalledWith({
      attributes: { oauth_client_scope_upgrade_error: 'D1 unavailable' },
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
      '/oauth2/client/rotate-keys',
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

  it('revokes every grant after revoking the other sessions', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/revoke-other-sessions',
      body: {},
      context: {
        returned: { status: true },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.revokeUserOAuthGrants).toHaveBeenCalledWith({
      userId: 9,
      trigger: 'revoke-other-sessions',
    })
  })

  it('keeps grants when a single session is revoked', async () => {
    const options = await importAuthOptions()

    await options.hooks!.after!({
      path: '/revoke-session',
      body: { token: 'session-token' },
      context: {
        returned: { status: true },
        session: { user: { id: '9', email: 'user@example.com' } },
      },
    } as any)

    expect(mocks.revokeUserOAuthGrants).not.toHaveBeenCalled()
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

  describe('superseded connection revoke', () => {
    function grantedConsent(clientQuery = 'client_id=client-1&sig=x') {
      return {
        path: '/oauth2/consent',
        body: { accept: true, oauth_query: clientQuery },
        context: {
          returned: {
            redirect: true,
            url: 'https://claude.ai/cb?code=abc&state=s',
          },
          session: { user: { id: '9', email: 'user@example.com' } },
        },
      } as any
    }

    it('revokes the older connections after a granted consent', async () => {
      const loggerSet = vi.fn()
      const options = await importAuthOptions(loggerSet)

      mocks.revokeSupersededClients.mockResolvedValueOnce([
        { clientId: 'old-1', scopes: ['openid', 'chats:read'] },
        { clientId: 'old-2', scopes: ['openid'] },
      ])

      await options.hooks!.after!(grantedConsent())

      expect(mocks.revokeSupersededClients)
        .toHaveBeenCalledWith(expect.anything(), 9, 'client-1')
      expect(mocks.logInfo).toHaveBeenCalledTimes(2)
      expect(mocks.logInfo).toHaveBeenCalledWith({
        action: 'oauth_revoked',
        userId: 9,
        attributes: {
          legalConsent: {
            action: 'oauth_revoked',
            oauthClientId: 'old-1',
            scopes: ['openid', 'chats:read'],
            reason: 'superseded',
            supersededBy: 'client-1',
          },
        },
      })
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          oauthAutoRevoke: { revokedClientIds: ['old-1', 'old-2'] },
        },
      })
    })

    it('runs after the email notification', async () => {
      const options = await importAuthOptions()
      const order: string[] = []

      mocks.notifyOAuthAppConnected.mockImplementationOnce(async () => {
        order.push('notify')
      })
      mocks.revokeSupersededClients.mockImplementationOnce(async () => {
        order.push('revoke')

        return []
      })

      await options.hooks!.after!(grantedConsent())

      expect(order).toEqual(['notify', 'revoke'])
    })

    it('logs nothing when no older connection was revoked', async () => {
      const loggerSet = vi.fn()
      const options = await importAuthOptions(loggerSet)

      await options.hooks!.after!(grantedConsent())

      expect(mocks.logInfo).not.toHaveBeenCalled()
      expect(loggerSet).toHaveBeenCalledTimes(1)
    })

    it('does not revoke when the approval returned an error redirect',
      async () => {
        const options = await importAuthOptions()
        const consent = grantedConsent()

        consent.context.returned = {
          redirect: true,
          url: 'https://claude.ai/cb?error=invalid_scope&state=s',
        }

        await options.hooks!.after!(consent)

        expect(mocks.notifyOAuthAppConnected).toHaveBeenCalledTimes(1)
        expect(mocks.revokeSupersededClients).not.toHaveBeenCalled()
        expect(mocks.logInfo).not.toHaveBeenCalled()
      })

    it('does not revoke when the approval returned no authorization code',
      async () => {
        const options = await importAuthOptions()
        const consent = grantedConsent()

        consent.context.returned = {
          redirect: true,
          url: '/signin?client_id=client-1',
        }

        await options.hooks!.after!(consent)

        expect(mocks.revokeSupersededClients).not.toHaveBeenCalled()
      })

    it('does not revoke when the consent is denied', async () => {
      const options = await importAuthOptions()

      await options.hooks!.after!({
        ...grantedConsent(),
        body: { accept: false, oauth_query: 'client_id=client-1&sig=x' },
      })

      expect(mocks.revokeSupersededClients).not.toHaveBeenCalled()
    })

    it('does not revoke when the consent names no client', async () => {
      const options = await importAuthOptions()

      await options.hooks!.after!(grantedConsent('sig=x'))

      expect(mocks.revokeSupersededClients).not.toHaveBeenCalled()
    })

    it('never fails the grant when the revoke fails', async () => {
      const loggerSet = vi.fn()
      const options = await importAuthOptions(loggerSet)

      mocks.revokeSupersededClients.mockRejectedValueOnce(
        new Error('D1 unavailable'),
      )

      await expect(options.hooks!.after!(grantedConsent()))
        .resolves.toBeUndefined()

      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { oauthAutoRevoke: { error: 'D1 unavailable' } },
      })
      expect(mocks.logInfo).not.toHaveBeenCalled()
    })
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
