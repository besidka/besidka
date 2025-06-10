import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from '../db/schema'

let _auth: ReturnType<typeof betterAuth>

export function useServerAuth() {
  if (_auth) {
    return _auth
  }

  const config = useRuntimeConfig()
  const {
    secret,
    providers: { google, github },
  } = config.betterAuth ?? {}
  const baseURL = getRequestURL(useEvent()).origin
  const db = useDb()
  const kv = useKV()
  const dataKey = 'auth'

  const { send: sendEmail } = useEmail()

  _auth = betterAuth({
    secret,
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
    baseURL,
    advanced: {
      database: {
        useNumberId: true,
        generateId: false,
        usePlural: true,
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      async sendResetPassword({ user, url }) {
        await sendEmail({
          to: user.email,
          subject: 'Reset your password',
          html: `Click the link to reset your password: ${url}`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendEmail({
          to: user.email,
          subject: 'Verify your email address',
          html: `Click the link to verify your email: ${url}`,
        })
      },
    },
    socialProviders: {
      google: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
      },
      github: {
        clientId: github.clientId,
        clientSecret: github.clientSecret,
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
