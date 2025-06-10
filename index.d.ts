declare module 'nuxt/schema' {

  interface RuntimeConfig {
    drizzle: {
      debug?: boolean
    }
    resend: {
      apiKey: string
      sender: {
        'no-reply': string
        'personalized': string
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
