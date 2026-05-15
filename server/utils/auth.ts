import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { lastLoginMethod, oAuthProxy } from 'better-auth/plugins'
import * as schema from '../db/schema'

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
  const rateLimitTtl = 60

  const allowedHosts = getAllowedHosts(config.public.baseUrl)

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
          ttl ? { expirationTtl: ttl } : undefined,
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
      customStorage: {
        async get(key) {
          const value = await kv.get(`${dataKey}:rate-limit:${key}`)

          if (!value) {
            return null
          }

          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        },
        async set(key, value) {
          await kv.put(
            `${dataKey}:rate-limit:${key}`,
            JSON.stringify(value),
            {
              expirationTtl: rateLimitTtl,
            },
          )
        },
      },
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
        })
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
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github', 'email-password'],
        allowDifferentEmails: false,
      },
    },
    plugins: [
      oAuthProxy({ productionURL: config.public.baseUrl }),
      lastLoginMethod({ storeInDatabase: true }),
    ],
  })
}

function getAllowedHosts(baseUrl: string): string[] {
  if (!baseUrl) {
    return []
  }

  const url = new URL(baseUrl)
  const host = url.host
  const hostname = url.hostname

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return [host, 'localhost:*', '127.0.0.1:*']
  }

  const parts = hostname.split('.')
  const twoPartDomain = parts.slice(-2).join('.')

  if (hostname === twoPartDomain) {
    return [host, `www.${hostname}`]
  }

  if (hostname === `www.${twoPartDomain}`) {
    return [host, twoPartDomain]
  }

  const subdomain = parts[0]
  const rest = parts.slice(1).join('.')

  return [host, `*-${subdomain}.${rest}`]
}
