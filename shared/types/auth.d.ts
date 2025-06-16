import * as schema from '~~/server/db/schema'

export type User = typeof schema.users.$inferSelect

export type Session = typeof schema.sessions.$inferSelect
