import type { Providers } from './shared/types/providers.d'
import type { AllowedFileFormats } from './shared/types/files.d'

declare module 'nuxt/schema' {

  interface RuntimeConfig {
    drizzleDebug?: boolean
    encryptionHashids: string
    encryptionKey: string
    emailNoopEnabled: boolean
    emailSenderNoreply: string
    emailSenderPersonalized: string
    betterAuthSecret: string
    googleClientId: string
    googleClientSecret: string
    githubClientId: string
    githubClientSecret: string
    filesHardMaxStorageBytes: number
    filesGlobalTransformLimitMonthly: number
    enableAssistantFilePersistence: boolean
    filesRetentionCleanupEnabled: boolean
    filesRetentionCleanupBatchSize: number
    filesRetentionCleanupMaxRuntimeMs: number
    filesMaintenanceToken: string
  }

  interface PublicRuntimeConfig {
    baseUrl: string
    defaultModel: string
    providers: Providers
    redirectUserTo: string
    redirectGuestTo: string
    allowedFileFormats: AllowedFileFormats
    maxFilesPerMessage: number
    maxMessageFilesBytes: number
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
