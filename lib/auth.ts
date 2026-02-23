import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { lastLoginMethod } from 'better-auth/plugins'

export const auth = betterAuth({
  database: drizzleAdapter(new Database('database.sqlite'), {
    provider: 'sqlite',
    usePlural: true,
  }),
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
    lastLoginMethod({ storeInDatabase: true }),
  ],
})
