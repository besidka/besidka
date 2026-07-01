import type { D1Database } from '@cloudflare/workers-types'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { createError } from 'evlog'
import type { RequestLogger } from 'evlog'
import { consentReceipts } from '~~/server/db/consent/schema'
import type { ConsentDecision } from '~~/server/utils/consents'
import { DrizzleQueryLogger } from '~~/server/utils/drizzle-logger'

export interface ConsentReceiptRecord {
  id: string
  createdAt: string
  revision: number
  granted: string[]
  denied: string[]
  changed: string[]
  decision: ConsentDecision
  consistent: boolean
  country: string | null
}

export function useConsentDb() {
  const db = env.CONSENT_DB as D1Database | undefined

  if (!db) {
    throw createError({
      status: 500,
      message: 'CONSENT_DB binding is not available',
      why: 'Cloudflare D1 binding `CONSENT_DB` is not available.',
      fix: 'Ensure runtime starts with Wrangler bindings and run `pnpm run db:consents:migrate` before E2E.',
    })
  }

  const runtimeConfig = useRuntimeConfig()

  return drizzle(db, {
    logger: runtimeConfig.drizzleDebug
      ? new DrizzleQueryLogger()
      : false,
  })
}

export async function insertConsentReceipt(
  receipt: ConsentReceiptRecord,
  logger: RequestLogger,
): Promise<void> {
  try {
    await useConsentDb()
      .insert(consentReceipts)
      .values({
        id: receipt.id,
        createdAt: receipt.createdAt,
        revision: receipt.revision,
        granted: receipt.granted,
        denied: receipt.denied,
        changed: receipt.changed,
        decision: receipt.decision,
        consistent: receipt.consistent,
        country: receipt.country,
      })
      .onConflictDoNothing()

    logger.set({ consentDb: { stored: true } })
  } catch (exception) {
    logger.set({
      consentDb: {
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    throw createError({
      message: 'Failed to store consent receipt',
      status: 500,
      why: exception instanceof Error ? exception.message : String(exception),
      fix: 'Verify CONSENT_DB binding and that consent migrations are applied.',
    })
  }
}
