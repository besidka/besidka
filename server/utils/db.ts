import type { D1Database } from '@cloudflare/workers-types'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { EnhancedQueryLogger } from 'drizzle-query-logger'
import * as schema from '~~/server/db/schema'

export function useDb() {
  const db = env.DB
  const runtimeConfig = useRuntimeConfig()

  if (!db) {
    throw createError({
      statusCode: 500,
      statusMessage: 'DB binding missing in runtime environment.',
      data: {
        why: 'Cloudflare D1 binding `DB` is not available.',
        fix: 'Ensure runtime starts with Wrangler bindings and run `pnpm run db:migrate` before E2E.',
      },
    })
  }

  return drizzle(db as D1Database, {
    schema,
    casing: 'snake_case',
    logger: runtimeConfig.drizzleDebug
      ? new EnhancedQueryLogger()
      : false,
  })
}
