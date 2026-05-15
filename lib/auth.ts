import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { lastLoginMethod, oAuthProxy } from 'better-auth/plugins'
import * as schema from '../server/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter({} as any, {
    provider: 'sqlite',
    schema,
    usePlural: true,
  }),
  advanced: {
    database: {
      generateId: 'serial',
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  socialProviders: {
    google: {
      clientId: '',
      clientSecret: '',
    },
    github: {
      clientId: '',
      clientSecret: '',
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
    oAuthProxy({ productionURL: '' }),
    lastLoginMethod({ storeInDatabase: true }),
  ],
})
