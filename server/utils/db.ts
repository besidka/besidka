import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

let db: DrizzleD1Database<typeof schema>

export function useDb() {
  // if (db) {
  //   return db
  // }

  db = (globalThis as any).__env__.DB

  if (!db) {
    throw createError('Database not found in ENV: DB')
  }

  const { debug: logger } = useRuntimeConfig().drizzle

  return drizzle(db as any, {
    schema,
    logger,
    casing: 'snake_case',
  })
}
