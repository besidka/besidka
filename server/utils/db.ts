import type { H3Event } from 'h3'
import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { EnhancedQueryLogger } from 'drizzle-query-logger'
import * as schema from '../db/schema'

export function useDb(event?: H3Event) {
  event = event ?? useEvent()

  if (!event.context?.cloudflare?.env) {
    throw createError('Cloudflare environment not found in event context')
  }

  const db = event.context.cloudflare.env.DB

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
