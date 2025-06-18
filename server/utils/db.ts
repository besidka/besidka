import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

export function useDb() {
  const db = (globalThis as any).__env__.DB

  if (!db) {
    throw createError('Database not found in ENV: DB')
  }

  return drizzle(db as any, {
    schema,
    logger: useRuntimeConfig()?.drizzle?.debug,
    casing: 'snake_case',
  })
}
