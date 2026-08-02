import type { BetterAuthPlugin } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  captcha,
  lastLoginMethod,
  oAuthProxy,
  twoFactor,
} from 'better-auth/plugins'
import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import * as schema from '../db/schema'
import { purgeUserData } from './account/purge-user-data'
import {
  sendPasswordChangedEmail,
  sendSignInMethodConnectedEmail,
  sendSignInMethodDisconnectedEmail,
  sendTwoFactorDisabledEmail,
  sendTwoFactorEnabledEmail,
} from './account/security-emails'
import { getAllowedHosts } from './auth-hosts'

type ServerAuth = ReturnType<typeof createAuth>

let _auth: ServerAuth | undefined

export function useServerAuth(): ServerAuth {
  if (!_auth) {
    _auth = createAuth()
  }

  return _auth
}

function createAuth() {
  const config = useRuntimeConfig()
  const db = useDb()
  const kv = useKV()
  const dataKey = 'auth'
  const deleteAccountTokenTtl = 60 * 60

  const allowedHosts = getAllowedHosts(config.public.baseUrl)
  const captchaOptions = getCaptchaOptions(config)

  const plugins: BetterAuthPlugin[] = [
    oAuthProxy({ productionURL: config.public.baseUrl }),
    lastLoginMethod({ storeInDatabase: true }),
    twoFactor({
      issuer: 'Besidka',
      totpOptions: {
        digits: 6,
        period: 30,
      },
      backupCodeOptions: {
        amount: 10,
        length: 10,
        storeBackupCodes: 'encrypted',
      },
    }),
  ]

  if (captchaOptions) {
    plugins.push(captcha(captchaOptions))
  }

  return betterAuth({
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      usePlural: true,
    }),
    secondaryStorage: {
      get: key => kv.get(`${dataKey}:${key}`),
      set: (key, value, ttl) => {
        return kv.put(
          `${dataKey}:${key}`,
          value,
          ttl ? { expirationTtl: Math.max(ttl, 60) } : undefined,
        )
      },
      delete: key => kv.delete(`${dataKey}:${key}`),
    },
    baseURL: {
      allowedHosts,
      protocol: 'auto',
      fallback: config.public.baseUrl || undefined,
    },
    session: {
      // Persist sessions to DB in addition to secondaryStorage (KV).
      // Without this, sessions live only in KV; once a KV entry expires or
      // becomes unavailable, Better Auth has no fallback and getSession()
      // returns null, forcing users to sign out and back in.
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes cache
      },
    },
    rateLimit: {
      window: authRateLimitDefaults.window,
      max: authRateLimitDefaults.max,
      customRules: authRateLimitRules,
      customStorage: createAuthRateLimitStorage(
        kv,
        `${dataKey}:rate-limit`,
      ),
    },
    advanced: {
      database: {
        generateId: 'serial',
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: import.meta.dev,
      requireEmailVerification: !import.meta.dev,
      async sendResetPassword({ user, url }) {
        const { send: sendEmail } = useEmail()

        await sendEmail({
          to: user.email,
          subject: 'Reset your password',
          html: `Click the link to reset your password: ${url}`,
          text: `Click the link to reset your password: ${url}`,
        })
      },
      // The forgot-password flow has no session to key the
      // '/change-password' hooks.after notification off of, so Better
      // Auth's own post-reset callback (resolved user, not just a token)
      // is the notification hook for this specific flow.
      async onPasswordReset({ user }) {
        await sendPasswordChangedEmail({ user })
      },
    },
    emailVerification: {
      sendOnSignUp: !import.meta.dev,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        if (import.meta.dev) {
          // eslint-disable-next-line no-console
          console.log(`Verification link for ${user.email}: ${url}`)
          return
        }

        const { send: sendEmail } = useEmail()

        await sendEmail({
          to: user.email,
          subject: 'Verify your email address',
          html: `Click the link to verify your email: ${url}`,
          text: `Click the link to verify your email: ${url}`,
        })
      },
    },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // Without this, '/change-email' only ever emails the *new*
        // address, never confirming via the address the account owner is
        // presumed to currently control. Configuring it makes the current,
        // already-verified address the one that authorizes the change.
        async sendChangeEmailConfirmation({ user, newEmail, url }) {
          if (import.meta.dev) {
            // eslint-disable-next-line no-console
            console.log(
              `Change email confirmation for ${user.email} -> ${newEmail}: ${url}`,
            )
            return
          }

          const { send: sendEmail } = useEmail()

          await sendEmail({
            to: user.email,
            subject: 'Confirm your new email address',
            html: `Click the link to confirm changing your account email to ${newEmail}: ${url}`,
            text: `Click the link to confirm changing your account email to ${newEmail}: ${url}`,
          })
        },
      },
      deleteUser: {
        enabled: true,
        deleteTokenExpiresIn: deleteAccountTokenTtl,
        // Configuring this callback moves erasure to a two-step flow:
        // POST /delete-user only mails a token, and the confirmation link
        // (GET /delete-user/callback) performs the deletion. That path never
        // reaches Better Auth's session-freshness gate, so erasure stays
        // reachable for OAuth-only users — who have no password to satisfy it
        // — without relaxing `session.freshAge` for every sensitive endpoint.
        async sendDeleteAccountVerification({ user, url }) {
          if (import.meta.dev) {
            // eslint-disable-next-line no-console
            console.log(`Account deletion link for ${user.email}: ${url}`)
            return
          }

          const { send: sendEmail } = useEmail()

          await sendEmail({
            to: user.email,
            subject: 'Confirm deleting your account',
            html: `Click the link to permanently delete your account and all associated data: ${url}`,
            text: `Click the link to permanently delete your account and all associated data: ${url}`,
          })
        },
        async beforeDelete(user) {
          await purgeUserData({ userId: Number(user.id) })
        },
      },
    },
    account: {
      // Covers `accessToken` and `refreshToken` only — Better Auth writes
      // `idToken` in plaintext regardless (api/routes/callback.mjs and
      // oauth2/link-account.mjs pass it straight through), so "OAuth tokens
      // are encrypted" is narrower than it sounds.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github', 'email-password'],
        allowDifferentEmails: false,
      },
    },
    databaseHooks: {
      account: {
        create: {
          // Fires for both a brand-new signup's first account row and every
          // subsequent OAuth link. Only the latter is a "new sign-in method
          // connected" event worth notifying about — the former is already
          // covered by the signup flow itself (verification/welcome email),
          // so it is distinguished here by counting the user's accounts
          // after this row landed: exactly one means this was the first.
          async after(account, context) {
            try {
              if (!context) {
                return
              }

              const existingAccounts = await context.context.internalAdapter
                .findAccounts(account.userId)

              if (existingAccounts.length <= 1) {
                return
              }

              const user = await context.context.internalAdapter
                .findUserById(account.userId)

              if (!user) {
                return
              }

              await sendSignInMethodConnectedEmail({
                user,
                providerId: account.providerId,
              })
            } catch (exception) {
              resolveServerLogger().set({
                securityNotificationHook: {
                  path: 'databaseHooks.account.create.after',
                  error: exceptionMessage(exception),
                },
              })
            }
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        try {
          if (isAPIError(ctx.context.returned)) {
            return
          }

          const user = ctx.context.session?.user

          if (!user) {
            return
          }

          if (ctx.path === '/change-password') {
            await sendPasswordChangedEmail({ user })

            return
          }

          if (ctx.path === '/unlink-account') {
            const providerId = ctx.body?.providerId

            if (typeof providerId === 'string') {
              await sendSignInMethodDisconnectedEmail({ user, providerId })
            }

            return
          }

          if (ctx.path === '/two-factor/enable') {
            const currentUser = await db.query.users.findFirst({
              where: { id: Number(user.id) },
              columns: { twoFactorEnabled: true },
            })

            if (currentUser?.twoFactorEnabled) {
              await sendTwoFactorEnabledEmail({ user })
            }

            return
          }

          if (ctx.path === '/two-factor/disable') {
            await sendTwoFactorDisabledEmail({ user })
          }
        } catch (exception) {
          resolveServerLogger().set({
            securityNotificationHook: {
              path: ctx.path,
              error: exceptionMessage(exception),
            },
          })
        }
      }),
    },
    plugins,
  })
}
