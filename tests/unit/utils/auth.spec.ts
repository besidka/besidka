import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveServerLogger } from '../../../server/utils/files/logger'
import { exceptionMessage } from '../../../server/utils/evlog-attributes'

const mocks = vi.hoisted(() => ({
  sendPasswordChangedEmail: vi.fn(async () => undefined),
  sendSignInMethodConnectedEmail: vi.fn(async () => undefined),
  sendSignInMethodDisconnectedEmail: vi.fn(async () => undefined),
  sendTwoFactorEnabledEmail: vi.fn(async () => undefined),
  sendTwoFactorDisabledEmail: vi.fn(async () => undefined),
  sendPasskeyAddedEmail: vi.fn(async () => undefined),
  sendPasskeyRemovedEmail: vi.fn(async () => undefined),
}))

const dbMocks = vi.hoisted(() => ({
  findFirstUser: vi.fn(async (): Promise<
    { twoFactorEnabled: boolean } | null
  > => null),
}))

vi.mock('~~/server/utils/account/security-emails', () => mocks)

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: vi.fn(),
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(),
}))

function stubBindings() {
  vi.stubGlobal('useRuntimeConfig', () => ({
    betterAuthSecret: 'secret',
    public: {
      baseUrl: 'https://example.com',
      turnstileSiteKey: '',
    },
    turnstileSecretKey: '',
    turnstileEnforced: false,
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
  }))
  vi.stubGlobal('useDb', () => ({
    query: {
      users: {
        findFirst: dbMocks.findFirstUser,
      },
    },
  }))
  vi.stubGlobal('useKV', () => ({}))
  vi.stubGlobal('getCaptchaOptions', () => null)
  vi.stubGlobal('authRateLimitDefaults', { window: 60, max: 60 })
  vi.stubGlobal('authRateLimitRules', {})
  vi.stubGlobal('createAuthRateLimitStorage', () => ({
    get: vi.fn(),
    set: vi.fn(),
    consume: vi.fn(),
  }))
  vi.stubGlobal('resolveServerLogger', resolveServerLogger)
  vi.stubGlobal('exceptionMessage', exceptionMessage)
}

async function importAuthOptions() {
  vi.resetModules()
  stubBindings()

  const { useServerAuth } = await import('../../../server/utils/auth')
  const auth = useServerAuth()

  await (auth as unknown as { $context: Promise<unknown> }).$context
    .catch(() => {})

  return auth.options
}

function createHookCtx(overrides: {
  path: string
  body?: Record<string, unknown>
  returned?: unknown
  user?: {
    id?: string
    email: string
  } | null
}) {
  return {
    path: overrides.path,
    body: overrides.body,
    context: {
      returned: overrides.returned,
      session: overrides.user ? { user: overrides.user } : undefined,
    },
  }
}

function createDatabaseHookAccount(overrides: {
  userId: string
  providerId: string
}) {
  return overrides
}

function createDatabaseHookContext(overrides: {
  findAccounts: (userId: string) => Promise<unknown[]>
  findUserById: (userId: string) => Promise<unknown>
}) {
  return { context: { internalAdapter: overrides } }
}

describe('server/utils/auth.ts security notification wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('databaseHooks.account.create.after', () => {
    it('does nothing when better-auth passes no context', async () => {
      const options = await importAuthOptions()
      const after = options.databaseHooks!.account!.create!.after!

      await after({ userId: '1', providerId: 'google' } as any, undefined)

      expect(mocks.sendSignInMethodConnectedEmail).not.toHaveBeenCalled()
    })

    it(
      'skips notifying when the account is the user\'s only one (signup)',
      async () => {
        const options = await importAuthOptions()
        const after = options.databaseHooks!.account!.create!.after!
        const findAccounts = vi.fn(async () => [{ id: 'a1' }])
        const findUserById = vi.fn()
        const account = createDatabaseHookAccount({
          userId: '1',
          providerId: 'credential',
        })
        const context = createDatabaseHookContext({
          findAccounts,
          findUserById,
        })

        await after(account as any, context as any)

        expect(findAccounts).toHaveBeenCalledWith('1')
        expect(findUserById).not.toHaveBeenCalled()
        expect(mocks.sendSignInMethodConnectedEmail).not.toHaveBeenCalled()
      },
    )

    it(
      'notifies when a second sign-in method is linked to an existing user',
      async () => {
        const options = await importAuthOptions()
        const after = options.databaseHooks!.account!.create!.after!
        const user = { id: '1', email: 'user@example.com' }
        const findAccounts = vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }])
        const findUserById = vi.fn(async () => user)
        const account = createDatabaseHookAccount({
          userId: '1',
          providerId: 'google',
        })
        const context = createDatabaseHookContext({
          findAccounts,
          findUserById,
        })

        await after(account as any, context as any)

        expect(findAccounts).toHaveBeenCalledWith('1')
        expect(findUserById).toHaveBeenCalledWith('1')
        expect(mocks.sendSignInMethodConnectedEmail).toHaveBeenCalledWith({
          user,
          providerId: 'google',
        })
      },
    )

    it('does not notify when the linked account\'s user cannot be found',
      async () => {
        const options = await importAuthOptions()
        const after = options.databaseHooks!.account!.create!.after!
        const findAccounts = vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }])
        const findUserById = vi.fn(async () => null)
        const account = createDatabaseHookAccount({
          userId: '1',
          providerId: 'google',
        })
        const context = createDatabaseHookContext({
          findAccounts,
          findUserById,
        })

        await after(account as any, context as any)

        expect(mocks.sendSignInMethodConnectedEmail).not.toHaveBeenCalled()
      })

    it(
      'catches a findAccounts failure and logs it instead of throwing',
      async () => {
        const options = await importAuthOptions()
        const after = options.databaseHooks!.account!.create!.after!
        const loggerSet = vi.fn()

        vi.stubGlobal('resolveServerLogger', () => ({ set: loggerSet }))

        const findAccounts = vi.fn(async () => {
          throw new Error('E_FIND_ACCOUNTS_FAILED')
        })
        const findUserById = vi.fn()
        const account = createDatabaseHookAccount({
          userId: '1',
          providerId: 'google',
        })
        const context = createDatabaseHookContext({
          findAccounts,
          findUserById,
        })

        await expect(after(account as any, context as any))
          .resolves.toBeUndefined()

        expect(findUserById).not.toHaveBeenCalled()
        expect(mocks.sendSignInMethodConnectedEmail).not.toHaveBeenCalled()
        expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
          securityNotificationHook: expect.objectContaining({
            path: 'databaseHooks.account.create.after',
            error: 'E_FIND_ACCOUNTS_FAILED',
          }),
        }))
      },
    )

    it(
      'catches a findUserById failure and logs it instead of throwing',
      async () => {
        const options = await importAuthOptions()
        const after = options.databaseHooks!.account!.create!.after!
        const loggerSet = vi.fn()

        vi.stubGlobal('resolveServerLogger', () => ({ set: loggerSet }))

        const findAccounts = vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }])
        const findUserById = vi.fn(async () => {
          throw new Error('E_FIND_USER_FAILED')
        })
        const account = createDatabaseHookAccount({
          userId: '1',
          providerId: 'google',
        })
        const context = createDatabaseHookContext({
          findAccounts,
          findUserById,
        })

        await expect(after(account as any, context as any))
          .resolves.toBeUndefined()

        expect(mocks.sendSignInMethodConnectedEmail).not.toHaveBeenCalled()
        expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
          securityNotificationHook: expect.objectContaining({
            path: 'databaseHooks.account.create.after',
            error: 'E_FIND_USER_FAILED',
          }),
        }))
      },
    )
  })

  describe('hooks.after', () => {
    it('skips notifying when the endpoint returned an API error', async () => {
      const options = await importAuthOptions()
      const after = options.hooks!.after!

      await after(createHookCtx({
        path: '/change-password',
        returned: { name: 'APIError' },
        user: { email: 'user@example.com' },
      }) as any)

      expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled()
    })

    it('skips notifying when there is no session user', async () => {
      const options = await importAuthOptions()
      const after = options.hooks!.after!

      await after(createHookCtx({
        path: '/change-password',
        user: null,
      }) as any)

      expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled()
    })

    it('sends the password-changed email for /change-password', async () => {
      const options = await importAuthOptions()
      const after = options.hooks!.after!
      const user = { email: 'user@example.com' }

      await after(createHookCtx({
        path: '/change-password',
        user,
      }) as any)

      expect(mocks.sendPasswordChangedEmail).toHaveBeenCalledWith({ user })
      expect(mocks.sendSignInMethodDisconnectedEmail).not.toHaveBeenCalled()
    })

    it(
      'sends the sign-in-method-disconnected email for /unlink-account',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { email: 'user@example.com' }

        await after(createHookCtx({
          path: '/unlink-account',
          body: { providerId: 'github' },
          user,
        }) as any)

        expect(mocks.sendSignInMethodDisconnectedEmail).toHaveBeenCalledWith({
          user,
          providerId: 'github',
        })
        expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled()
      },
    )

    it(
      'does not notify for /unlink-account when providerId is missing',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!

        await after(createHookCtx({
          path: '/unlink-account',
          body: {},
          user: { email: 'user@example.com' },
        }) as any)

        expect(mocks.sendSignInMethodDisconnectedEmail).not.toHaveBeenCalled()
      },
    )

    it(
      'skips notifying for /two-factor/enable while unverified',
      async () => {
        dbMocks.findFirstUser.mockResolvedValueOnce({
          twoFactorEnabled: false,
        })

        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { id: '1', email: 'user@example.com' }

        await after(createHookCtx({
          path: '/two-factor/enable',
          returned: { totpURI: 'otpauth://totp/x', backupCodes: ['a'] },
          user,
        }) as any)

        expect(dbMocks.findFirstUser).toHaveBeenCalledWith({
          where: { id: 1 },
          columns: { twoFactorEnabled: true },
        })
        expect(mocks.sendTwoFactorEnabledEmail).not.toHaveBeenCalled()
      },
    )

    it(
      'sends the two-factor-enabled email once /two-factor/enable '
      + 'actually finished verification',
      async () => {
        dbMocks.findFirstUser.mockResolvedValueOnce({
          twoFactorEnabled: true,
        })

        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { id: '1', email: 'user@example.com' }

        await after(createHookCtx({
          path: '/two-factor/enable',
          user,
        }) as any)

        expect(mocks.sendTwoFactorEnabledEmail).toHaveBeenCalledWith({ user })
      },
    )

    it(
      'catches a /two-factor/enable lookup failure and logs it',
      async () => {
        dbMocks.findFirstUser.mockRejectedValueOnce(
          new Error('E_LOOKUP_FAILED'),
        )

        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const loggerSet = vi.fn()

        vi.stubGlobal('resolveServerLogger', () => ({ set: loggerSet }))

        await expect(after(createHookCtx({
          path: '/two-factor/enable',
          user: { id: '1', email: 'user@example.com' },
        }) as any)).resolves.toBeUndefined()

        expect(mocks.sendTwoFactorEnabledEmail).not.toHaveBeenCalled()
        expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
          securityNotificationHook: expect.objectContaining({
            path: '/two-factor/enable',
            error: 'E_LOOKUP_FAILED',
          }),
        }))
      },
    )

    it('sends the two-factor-disabled email for /two-factor/disable',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { id: '1', email: 'user@example.com' }

        await after(createHookCtx({
          path: '/two-factor/disable',
          user,
        }) as any)

        expect(mocks.sendTwoFactorDisabledEmail)
          .toHaveBeenCalledWith({ user })
        expect(mocks.sendTwoFactorEnabledEmail).not.toHaveBeenCalled()
      })

    it(
      'sends the passkey-added email for /passkey/verify-registration',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { id: '1', email: 'user@example.com' }

        await after(createHookCtx({
          path: '/passkey/verify-registration',
          user,
        }) as any)

        expect(mocks.sendPasskeyAddedEmail).toHaveBeenCalledWith({ user })
        expect(mocks.sendPasskeyRemovedEmail).not.toHaveBeenCalled()
      },
    )

    it(
      'skips notifying for /passkey/verify-registration on an API error',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!

        await after(createHookCtx({
          path: '/passkey/verify-registration',
          returned: { name: 'APIError' },
          user: { id: '1', email: 'user@example.com' },
        }) as any)

        expect(mocks.sendPasskeyAddedEmail).not.toHaveBeenCalled()
      },
    )

    it('sends the passkey-removed email for /passkey/delete-passkey',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const user = { id: '1', email: 'user@example.com' }

        await after(createHookCtx({
          path: '/passkey/delete-passkey',
          user,
        }) as any)

        expect(mocks.sendPasskeyRemovedEmail).toHaveBeenCalledWith({ user })
        expect(mocks.sendPasskeyAddedEmail).not.toHaveBeenCalled()
      })

    it(
      'skips notifying for /passkey/delete-passkey on an API error',
      async () => {
        const options = await importAuthOptions()
        const after = options.hooks!.after!

        await after(createHookCtx({
          path: '/passkey/delete-passkey',
          returned: { name: 'APIError' },
          user: { id: '1', email: 'user@example.com' },
        }) as any)

        expect(mocks.sendPasskeyRemovedEmail).not.toHaveBeenCalled()
      },
    )

    it('ignores every other path', async () => {
      const options = await importAuthOptions()
      const after = options.hooks!.after!

      await after(createHookCtx({
        path: '/sign-in/email',
        user: { email: 'user@example.com' },
      }) as any)

      expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled()
      expect(mocks.sendSignInMethodDisconnectedEmail).not.toHaveBeenCalled()
      expect(mocks.sendTwoFactorEnabledEmail).not.toHaveBeenCalled()
      expect(mocks.sendTwoFactorDisabledEmail).not.toHaveBeenCalled()
      expect(mocks.sendPasskeyAddedEmail).not.toHaveBeenCalled()
      expect(mocks.sendPasskeyRemovedEmail).not.toHaveBeenCalled()
    })

    it(
      'catches a notification failure and logs it instead of throwing',
      async () => {
        mocks.sendPasswordChangedEmail.mockRejectedValueOnce(
          new Error('E_SEND_FAILED'),
        )

        const options = await importAuthOptions()
        const after = options.hooks!.after!
        const loggerSet = vi.fn()

        vi.stubGlobal('resolveServerLogger', () => ({ set: loggerSet }))

        await expect(after(createHookCtx({
          path: '/change-password',
          user: { email: 'user@example.com' },
        }) as any)).resolves.toBeUndefined()

        expect(loggerSet).toHaveBeenCalledWith(expect.objectContaining({
          securityNotificationHook: expect.objectContaining({
            path: '/change-password',
            error: 'E_SEND_FAILED',
          }),
        }))
      },
    )
  })
})
