import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { EnhancedQueryLogger } from 'drizzle-query-logger'
import * as schema from '../db/schema'
import { env } from 'cloudflare:workers'

export function useDb() {
  const db = env.DB
  if (!db) {
    throw createError('Database not found in ENV: DB')
  }

  return drizzle(db as D1Database, {
    schema,
    casing: 'snake_case',
    logger: useRuntimeConfig(useEvent())?.drizzleDebug
      ? new EnhancedQueryLogger()
      : false,
  })
}
