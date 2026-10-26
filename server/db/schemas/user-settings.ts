import type { GatewayId } from '#shared/types/gateways.d'
import type { ProviderTransferConsents } from '#shared/types/legal-consent.d'
import { gatewayIds } from '#shared/utils/gateways'
import { sql } from 'drizzle-orm'
import {
  snakeCase,
  index,
  integer,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { defaultSchemaTimestamps } from '../../utils/schema'
import { users } from './auth'

export const userSettings = snakeCase.table(
  'user_settings',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reasoningExpanded: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    reasoningAutoHide: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    allowExternalLinks: integer({ mode: 'boolean' }),
    notificationPromptState: integer({ mode: 'boolean' }),
    sidebarPinned: integer({ mode: 'boolean' }),
    favoriteModels: text({ mode: 'json' }).$type<string[]>(),
    favoriteGatewayModels: text({ mode: 'json' })
      .$type<Partial<Record<GatewayId, string[]>>>(),
    memoryEnabled: integer({ mode: 'boolean' }),
    memoryExtractionEnabled: integer({ mode: 'boolean' }),
    memoryExtractionEnabledAt: integer({ mode: 'timestamp' }),
    chatSearchEnabled: integer({ mode: 'boolean' }),
    memoryIncludeSensitive: integer({ mode: 'boolean' }),
    aboutMe: text(),
    profileMemoryModel: text(),
    profileMemoryGateway: text({ enum: gatewayIds }),
    projectMemoryModel: text(),
    projectMemoryGateway: text({ enum: gatewayIds }),
    termsAcceptedAt: integer({ mode: 'timestamp' }),
    termsVersion: text(),
    ageConfirmedAt: integer({ mode: 'timestamp' }),
    sensitiveContentConsentAt: integer({ mode: 'timestamp' }),
    sensitiveContentConsentVersion: text(),
    sensitiveContentConsentWithdrawnAt: integer({ mode: 'timestamp' }),
    providerTransferConsents: text({ mode: 'json' })
      .$type<ProviderTransferConsents>(),
  },
  table => [
    uniqueIndex('uq_user_settings_user').on(table.userId),
    index('idx_user_settings_extraction_enabled')
      .on(table.userId)
      .where(sql`memory_extraction_enabled = 1`),
  ],
)
