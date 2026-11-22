import { GOOGLE_CLIENT_MODES } from '#shared/utils/google-scopes'
import { GOOGLE_CONNECTION_STATUSES } from '#shared/utils/google-connections'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const googleConnections = snakeCase.table(
  'google_connections',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' }).notNull(),
    clientMode: text({ enum: GOOGLE_CLIENT_MODES }).notNull(),
    googleSubject: text(),
    googleEmail: text(),
    grantedScopes: text({ mode: 'json' }).$type<string[]>().notNull(),
    refreshToken: text(),
    accessToken: text(),
    accessTokenExpiresAt: integer({ mode: 'timestamp' }),
    status: text({ enum: GOOGLE_CONNECTION_STATUSES }).notNull(),
    lastRefreshedAt: integer({ mode: 'timestamp' }),
    lastUsedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_google_connections_user_mode')
      .on(table.userId, table.clientMode),
    index('idx_google_connections_user').on(table.userId),
  ],
)
