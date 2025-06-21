import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from '../db/schema'

let _auth: ReturnType<typeof betterAuth>

export function useServerAuth() {
  if (_auth) {
    return _auth
  }

  const config = useRuntimeConfig(useEvent())
  const db = useDb()
  const kv = useKV()
  const dataKey = 'auth'

  const { send: sendEmail } = useEmail()

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
    baseURL: config.baseUrl || getRequestURL(useEvent()).origin,
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
