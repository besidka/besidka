import type { GatewayId } from '#shared/types/gateways.d'
import { gatewayIds } from '#shared/utils/gateways'
import {
  snakeCase,
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
    chatSearchEnabled: integer({ mode: 'boolean' }),
    memoryIncludeSensitive: integer({ mode: 'boolean' }),
    aboutMe: text(),
    profileMemoryModel: text(),
    profileMemoryGateway: text({ enum: gatewayIds }),
    projectMemoryModel: text(),
    projectMemoryGateway: text({ enum: gatewayIds }),
  },
  table => [
    uniqueIndex('uq_user_settings_user').on(table.userId),
  ],
)
