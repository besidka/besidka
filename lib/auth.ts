import type { BetterAuthPlugin } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  captcha,
  lastLoginMethod,
  oAuthProxy,
  twoFactor,
} from 'better-auth/plugins'
import { createAuthMiddleware } from 'better-auth/api'
import * as schema from '../server/db/schema'
import {
  authRateLimitDefaults,
  authRateLimitRules,
  createAuthRateLimitStorage,
} from '../server/utils/auth-rate-limit'

const turnstileSecretKey = ''
const turnstileSiteKey = ''
const turnstileEnforced = false
const captchaEnabled = Boolean(turnstileSecretKey) && Boolean(turnstileSiteKey)

const plugins: BetterAuthPlugin[] = [
  oAuthProxy({ productionURL: '' }),
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

if (captchaEnabled) {
  plugins.push(captcha({
    provider: 'cloudflare-turnstile',
    secretKey: turnstileSecretKey,
    endpoints: [
      '/sign-up/email',
      '/sign-in/email',
      '/request-password-reset',
    ],
    expectedAction: turnstileEnforced ? 'auth' : undefined,
    allowedHostnames: turnstileEnforced ? [] : undefined,
  }))
}

export const auth = betterAuth({
  database: drizzleAdapter({} as any, {
    provider: 'sqlite',
    schema,
    usePlural: true,
  }),
  rateLimit: {
    window: authRateLimitDefaults.window,
    max: authRateLimitDefaults.max,
    customRules: authRateLimitRules,
    customStorage: createAuthRateLimitStorage(
      {} as any,
      'auth:rate-limit',
    ),
  },
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
  user: {
    changeEmail: {
      enabled: true,
      async sendChangeEmailConfirmation() {},
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github', 'email-password'],
      allowDifferentEmails: false,
    },
  },
  databaseHooks: {
    account: {
      create: {
        async after() {},
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async () => {}),
  },
  plugins,
})
