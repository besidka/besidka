export interface Provider {
  id: string
  name: string
  models: Model[]
}

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

declare module 'nuxt/schema' {

  interface RuntimeConfig {
    drizzle: {
      debug?: boolean
    }
    resend: {
      apiKey: string
      sender: {
        noreply: string
        personalized: string
      }
    }
    betterAuth: {
      secret: string
      providers: {
        google: {
          clientId: string
          clientSecret: string
        }
        github: {
          clientId: string
          clientSecret: string
        }
      }
    }
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
