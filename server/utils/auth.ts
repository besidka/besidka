import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from '../db/schema'

let _auth: ReturnType<typeof betterAuth>

export function useServerAuth(event?: H3Event) {
  if (_auth) {
    return _auth
  }

  event = event ?? useEvent()

  const config = useRuntimeConfig(event)
  const db = useDb()
  const kv = useKV()
  const dataKey = 'auth'

  _auth = betterAuth({
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      usePlural: true,
    }),
    secondaryStorage: {
      get: key => kv.get(`${dataKey}:${key}`),
      set: (key, value, ttl) => {
        return kv.put(`${dataKey}:${key}`, value, {
          expirationTtl: ttl,
        })
      },
      delete: key => kv.delete(`${dataKey}:${key}`),
    },
    baseURL: getBaseURL(event),
    trustedOrigins: getTrustedOrigins(event),
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes cache
      },
    },
    advanced: {
      database: {
        useNumberId: true,
        generateId: false,
        usePlural: true,
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
  })

  return _auth
}

function getBaseURL(event: H3Event): string {
  let baseURL = useRuntimeConfig(event).public.baseUrl

  if (!baseURL) {
    try {
      baseURL = getRequestURL(event).origin
    } catch (_exception) {
      if (import.meta.dev) {
        // eslint-disable-next-line no-console
        console.log('Failed to get base URL:', _exception)
      }
    }
  }

  return baseURL
}

function getTrustedOrigins(event: H3Event): string[] {
  const config = useRuntimeConfig(event)
  const baseUrl = config.public.baseUrl

  if (!baseUrl) {
    return []
  }

  const origins: string[] = [baseUrl]
  const url = new URL(baseUrl)
  const hostname = url.hostname

  // Preview environment: hostname contains 'preview'
  if (hostname.includes('preview')) {
    // Generate wildcard: example.workers.dev -> *-example.workers.dev
    origins.push(`${url.protocol}//*-${hostname}`)
  } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Development: localhost or 127.0.0.1
    origins.push('http://localhost:*', 'http://127.0.0.1:*')
  } else {
    // Production: add www/apex domain variant
    const parts = hostname.split('.')

    if (parts.length === 2) {
      // Apex domain (e.g., besidka.com) -> add www variant
      origins.push(`${url.protocol}//www.${hostname}`)
    } else if (hostname.startsWith('www.')) {
      // www domain -> add apex variant
      const apexDomain = hostname.replace('www.', '')
      origins.push(`${url.protocol}//${apexDomain}`)
    }
  }

  return origins
}
