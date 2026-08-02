import {
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchema } from '../../utils/schema'

export const passkeys = snakeCase.table(
  'passkeys',
  {
    ...defaultSchema,
    name: text(),
    publicKey: text().notNull(),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text().notNull(),
    counter: integer({ mode: 'number' }).notNull(),
    deviceType: text().notNull(),
    backedUp: integer({ mode: 'boolean' }).notNull(),
    transports: text(),
    aaguid: text(),
  },
  table => [
    index('idx_passkeys_user_id').on(table.userId),
    index('idx_passkeys_credential_id').on(table.credentialID),
  ],
)
