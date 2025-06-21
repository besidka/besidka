export interface Model {
  id: string
  name: string
  default?: boolean
  description: string
  contextLength: number
  maxOutputTokens: number
  price: {
    tokens: number
    input: string
    output: string
  }
  modalities: {
    input: string[]
    output: string[]
  }
  tools: string[]
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

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
    providers: {
      [key: string]: Provider
    }
  }

  interface PublicRuntimeConfig {
    defaultModel: string
    providers: string[]
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
