import { drizzle } from 'drizzle-orm/d1'
import { EnhancedQueryLogger } from 'drizzle-query-logger'
import * as schema from '../db/schema'

export function useDb() {
  const db = useEvent().context.cloudflare.env.DB

  if (!db) {
    throw createError('Database not found in ENV: DB')
  }

  return drizzle(db, {
    schema,
    casing: 'snake_case',
    logger: useRuntimeConfig(useEvent())?.drizzleDebug
      ? new EnhancedQueryLogger()
      : false,
  })
}
