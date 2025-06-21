import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

export function useDb() {
  const db = useEvent().context.cloudflare.env.DB

  if (!db) {
    throw createError('Database not found in ENV: DB')
  }

  return drizzle(db, {
    schema,
    logger: useRuntimeConfig(useEvent())?.drizzleDebug,
    casing: 'snake_case',
  })
}
