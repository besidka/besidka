import type { Providers } from './shared/types/providers.d'

declare module 'nuxt/schema' {

  interface RuntimeConfig {
    baseUrl: string
    drizzleDebug?: boolean
    encryptionHashids: string
    encryptionKey: string
    resendApiKey: string
    resendSenderNoreply: string
    resendSenderPersonalized: string
    betterAuthSecret: string
    googleClientId: string
    googleClientSecret: string
    githubClientId: string
    githubClientSecret: string
  }

  interface PublicRuntimeConfig {
    defaultModel: string
    providers: Providers
  }

  interface AppConfigInput {
    siteName: string
    messages: {
      autoRemove: boolean
      autoRemoveTimeout: number
    }
  }
}

export {}
