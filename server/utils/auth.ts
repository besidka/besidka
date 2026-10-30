import type { BetterAuthPlugin } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  captcha,
  jwt,
  lastLoginMethod,
  oAuthProxy,
  twoFactor,
} from 'better-auth/plugins'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { mcp } from '@better-auth/mcp'
import { passkey } from '@better-auth/passkey'
import { jwtVerify } from 'jose'
import type {
  ModuleOptions,
} from '~~/modules/cookie-consent/src/runtime/types/module'
import { isConsentCategoryGranted } from '~~/server/utils/consents'
import * as schema from '../db/schema'
import {
  recordSignupActivation,
  resolveSignupUtm,
} from '~~/server/utils/analytics/activation'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import {
  purgeUserData,
  purgeUserOAuthData,
} from './account/purge-user-data'
import { notifyOAuthAppConnected } from './account/notify-oauth-app-connected'
import { revokeUserOAuthGrants } from './account/revoke-user-oauth-grants'
import {
  OAUTH_AUTHORIZE_PATH,
  refreshStaleClientScopes,
} from './oauth/client-scope-upgrade'
import { findClientRegistrationViolation } from './oauth/registration-limits'
import {
  sendEmailChangedEmail,
  sendPasskeyAddedEmail,
  sendPasskeyRemovedEmail,
  sendPasswordChangedEmail,
  sendSignInMethodConnectedEmail,
  sendSignInMethodDisconnectedEmail,
  sendTwoFactorBackupCodesRegeneratedEmail,
  sendTwoFactorDisabledEmail,
  sendTwoFactorEnabledEmail,
} from './account/security-emails'
import {
  getAllowedHosts,
  getRelyingPartyId,
  isSecureBaseUrl,
} from './auth-hosts'

type ServerAuth = ReturnType<typeof createAuth>

let _auth: ServerAuth | undefined

const IMAGE_REJECTING_PATHS = new Set(['/update-user', '/sign-up/email'])
const DEFAULT_SITE_URL = 'https://besidka.com'
const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const OAUTH_CLIENT_REGISTRATION_PATH = '/oauth2/register'
const OAUTH_CONSENT_PATH = '/oauth2/consent'
const OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const

export const DISABLED_AUTH_PATHS = [
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
]

export const PRIVILEGED_CLIENT_REGISTRATION_FIELDS = [
  'skip_consent',
  'skipConsent',
  'enable_end_session',
  'enableEndSession',
] as const

/**
 * Removes the client fields that only an administrator may set from a
 * dynamic client registration body, in place, so an unauthenticated client
 * can never register itself as consent-free or as a logout initiator.
 */
export function stripPrivilegedClientRegistrationFields(
  body: Record<string, unknown> | undefined,
): void {
  if (!body || typeof body !== 'object') {
    return
  }

  for (const field of PRIVILEGED_CLIENT_REGISTRATION_FIELDS) {
    Reflect.deleteProperty(body, field)
  }
}

export function assertClientRegistrationWithinLimits(
  body: Record<string, unknown> | undefined,
  contentLengthHeader?: string | null,
): void {
  const violation = findClientRegistrationViolation(
    body,
    contentLengthHeader,
  )

  if (violation) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_client_metadata',
      error_description: violation,
    })
  }
}

interface OAuthConsentDecision {
  action: 'oauth_granted' | 'oauth_denied'
  clientId: string | null
  scopes: string[]
}

export function resolveOAuthConsentDecision(
  body: Record<string, unknown> | undefined,
): OAuthConsentDecision {
  const oauthQuery = typeof body?.oauth_query === 'string'
    ? new URLSearchParams(body.oauth_query)
    : new URLSearchParams()
  const acceptedScope = typeof body?.scope === 'string'
    ? body.scope
    : oauthQuery.get('scope') ?? ''

  return {
    action: body?.accept === true ? 'oauth_granted' : 'oauth_denied',
    clientId: oauthQuery.get('client_id'),
    scopes: body?.accept === true
      ? acceptedScope.split(' ').filter(Boolean)
      : [],
  }
}

export function useServerAuth(): ServerAuth {
  if (!_auth) {
    _auth = createAuth()
  }

  return _auth
}

function isPreferencesConsentGranted(
  options: ModuleOptions | undefined,
  getCookie: (name: string) => string | null,
): boolean {
  if (!options) {
    return false
  }

  return isConsentCategoryGranted(
    getCookie(options.cookieName),
    'preferences',
    options.revision,
  )
}

function createAuth() {
  const config = useRuntimeConfig()
  const db = useDb()
  const kv = useKV()
  const dataKey = 'auth'
  const deleteAccountTokenTtl = 60 * 60
  const isCiEnvironment: boolean = process.env.CI === 'true'
  const isRateLimitEnabled: boolean = !import.meta.dev
    && !(isCiEnvironment && config.public.e2eTestHooksEnabled)

  const allowedHosts = getAllowedHosts(
    config.public.baseUrl,
    config.authAdditionalAllowedHosts,
  )
  const captchaOptions = getCaptchaOptions(config)
  const siteUrl = config.public.baseUrl || DEFAULT_SITE_URL

  const plugins: BetterAuthPlugin[] = [
    oAuthProxy({ productionURL: config.public.baseUrl }),
    lastLoginMethod({
      storeInDatabase: true,
      beforeStoreCookie: (ctx) => {
        return isPreferencesConsentGranted(
          config.public.cookieConsent as ModuleOptions | undefined,
          ctx.getCookie,
        )
      },
    }),
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
    passkey({
      rpID: getRelyingPartyId(config.public.baseUrl),
      rpName: 'Besidka',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    }),
    jwt({
      disableSettingJwtHeader: true,
      jwt: {
        issuer: siteUrl,
      },
    }),
    mcp({
      resource: `${siteUrl}/mcp`,
      loginPage: '/signin',
      consentPage: '/oauth/consent',
      scopes: [...MCP_OAUTH_SCOPES],
      clientRegistrationDefaultScopes: [...MCP_OAUTH_SCOPES],
      clientRegistrationDefaultApplicationType: 'infer',
      grantTypes: [...OAUTH_GRANT_TYPES],
      accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
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
    disabledPaths: DISABLED_AUTH_PATHS,
    secondaryStorage: createAuthSecondaryStorage(kv, dataKey),
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
      enabled: isRateLimitEnabled,
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
      defaultCookieAttributes: {
        secure: isSecureBaseUrl(config.public.baseUrl),
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: import.meta.dev || isCiEnvironment,
      requireEmailVerification: !import.meta.dev && !isCiEnvironment,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await sendTemplateEmail({
          to: user.email,
          subject: 'Reset your password',
          template: 'ActionEmail',
          props: {
            preview: 'Reset your Besidka account password',
            heading: 'Reset your password',
            intro: 'We received a request to reset your Besidka account '
              + 'password.',
            ctaLabel: 'Reset password',
            url,
            footnote: 'If you didn\'t request this, you can safely ignore '
              + 'this email.',
          },
        })
      },
      // The forgot-password flow has no session to key the
      // '/change-password' hooks.after notification off of, so Better
      // Auth's own post-reset callback (resolved user, not just a token)
      // is the notification hook for this specific flow.
      async onPasswordReset({ user }) {
        await revokeUserOAuthGrants({
          userId: Number(user.id),
          trigger: 'reset-password',
        })
        await sendPasswordChangedEmail({ user })
      },
    },
    emailVerification: {
      sendOnSignUp: !import.meta.dev && !isCiEnvironment,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        if (import.meta.dev) {
          // eslint-disable-next-line no-console
          console.log(`Verification link for ${user.email}: ${url}`)
          return
        }

        await sendTemplateEmail({
          to: user.email,
          subject: 'Verify your email address',
          template: 'ActionEmail',
          props: {
            preview: 'Verify your Besidka email address',
            heading: 'Verify your email address',
            intro: 'Confirm this is your email address to finish setting '
              + 'up your Besidka account.',
            ctaLabel: 'Verify email',
            url,
            footnote: 'If you didn\'t create a Besidka account, you can '
              + 'safely ignore this email.',
          },
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

          await sendTemplateEmail({
            to: user.email,
            subject: 'Confirm your new email address',
            template: 'ActionEmail',
            props: {
              preview: 'Confirm your new Besidka email address',
              heading: 'Confirm your new email address',
              intro: 'We received a request to change your Besidka '
                + `account email address to ${newEmail}.`,
              ctaLabel: 'Confirm change',
              url,
              footnote: 'If you didn\'t request this, you can safely '
                + 'ignore this email.',
            },
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

          await sendTemplateEmail({
            to: user.email,
            subject: 'Confirm deleting your account',
            template: 'ActionEmail',
            props: {
              preview: 'Confirm deleting your Besidka account',
              heading: 'Confirm deleting your account',
              intro: 'We received a request to permanently delete your '
                + 'Besidka account.',
              ctaLabel: 'Delete my account',
              url,
              footnote: 'This permanently deletes your account and all '
                + 'associated data - chats, files, and settings - and '
                + 'cannot be undone. If you didn\'t request this, you can '
                + 'safely ignore this email.',
            },
          })
        },
        async beforeDelete(user) {
          await purgeUserOAuthData({ userId: Number(user.id) })
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
      user: {
        create: {
          async after(user, context) {
            try {
              await recordSignupActivation(
                Number(user.id),
                await resolveSignupUtm(context),
              )
            } catch (exception) {
              resolveServerLogger().set({
                attributes: {
                  analytics: {
                    error: exceptionMessage(exception),
                    event: 'signup_completed',
                  },
                },
              })
            }
          },
        },
      },
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
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === OAUTH_CLIENT_REGISTRATION_PATH) {
          stripPrivilegedClientRegistrationFields(ctx.body)
          assertClientRegistrationWithinLimits(
            ctx.body,
            ctx.request?.headers.get('content-length'),
          )

          return
        }

        if (ctx.path === OAUTH_AUTHORIZE_PATH) {
          const clientId = ctx.query?.client_id

          if (typeof clientId === 'string' && clientId.length > 0) {
            await refreshStaleClientScopes(
              clientId,
              ctx.context.adapter,
              resolveServerLogger(),
            )
          }

          return
        }

        if (!IMAGE_REJECTING_PATHS.has(ctx.path)) {
          return
        }

        if (ctx.body && 'image' in ctx.body) {
          throw new APIError('BAD_REQUEST', {
            message: 'Profile image cannot be changed',
          })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        try {
          if (ctx.path === '/verify-email') {
            const token = ctx.query?.token

            if (typeof token !== 'string') {
              return
            }

            let payload: Record<string, unknown>

            try {
              const verified = await jwtVerify(
                token,
                new TextEncoder().encode(config.betterAuthSecret),
                { algorithms: ['HS256'] },
              )

              payload = verified.payload
            } catch {
              return
            }

            if (payload.requestType !== 'change-email-verification') {
              return
            }

            const previousEmail = payload.email
            const newEmail = payload.updateTo

            if (
              typeof previousEmail !== 'string'
              || typeof newEmail !== 'string'
            ) {
              return
            }

            const updatedUser = await db.query.users.findFirst({
              where: { email: newEmail },
              columns: { email: true },
            })

            if (!updatedUser) {
              return
            }

            await sendEmailChangedEmail({
              user: { email: previousEmail },
              newEmail,
            })

            return
          }

          if (isAPIError(ctx.context.returned)) {
            return
          }

          const user = ctx.context.session?.user

          if (!user) {
            return
          }

          if (ctx.path === OAUTH_CONSENT_PATH) {
            const decision = resolveOAuthConsentDecision(ctx.body)

            resolveServerLogger().set({
              userId: Number(user.id),
              attributes: {
                legalConsent: {
                  action: decision.action,
                  oauthClientId: decision.clientId,
                  scopes: decision.scopes,
                },
              },
            })

            if (decision.action === 'oauth_granted') {
              await notifyOAuthAppConnected({
                user,
                clientId: decision.clientId,
                scopes: decision.scopes,
              })
            }

            return
          }

          if (ctx.path === '/change-password') {
            if (ctx.body?.revokeOtherSessions === true) {
              await revokeUserOAuthGrants({
                userId: Number(user.id),
                trigger: 'change-password',
              })
            }

            await sendPasswordChangedEmail({ user })

            return
          }

          if (ctx.path === '/revoke-sessions') {
            await revokeUserOAuthGrants({
              userId: Number(user.id),
              trigger: 'revoke-sessions',
            })

            return
          }

          if (ctx.path === '/revoke-other-sessions') {
            await revokeUserOAuthGrants({
              userId: Number(user.id),
              trigger: 'revoke-other-sessions',
            })

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

            return
          }

          if (ctx.path === '/two-factor/generate-backup-codes') {
            await sendTwoFactorBackupCodesRegeneratedEmail({ user })

            return
          }

          if (ctx.path === '/passkey/verify-registration') {
            await sendPasskeyAddedEmail({ user })

            return
          }

          if (ctx.path === '/passkey/delete-passkey') {
            await sendPasskeyRemovedEmail({ user })
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
