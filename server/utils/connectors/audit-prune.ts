import { inArray, lt } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  CONNECTOR_AUDIT_PRUNE_BATCH,
  CONNECTOR_AUDIT_PRUNE_MAX_RUNTIME_MS,
  CONNECTOR_AUDIT_RETENTION_DAYS,
} from '#shared/utils/connectors-policy'

type DbClient = ReturnType<typeof useDb>

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export interface ConnectorAuditPruneResult {
  deleted: number
  batches: number
  isTruncated: boolean
}

/**
 * Deletes `connector_tool_calls` rows older than the 90 day retention in
 * batches of `CONNECTOR_AUDIT_PRUNE_BATCH`, oldest first through the
 * `created_at` index. It stops at the first short batch, or when the runtime
 * cap is spent before a further batch starts; a backlog drains over the next
 * hourly runs.
 */
export async function pruneConnectorAuditRows(input: {
  db: DbClient
  now: Date
  maxRuntimeMs?: number
  readClockMs?: () => number
}): Promise<ConnectorAuditPruneResult> {
  const readClockMs = input.readClockMs || Date.now
  const maxRuntimeMs = input.maxRuntimeMs
    ?? CONNECTOR_AUDIT_PRUNE_MAX_RUNTIME_MS
  const startedAtMs = readClockMs()
  const cutoff = new Date(
    input.now.getTime() - CONNECTOR_AUDIT_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  )
  const result: ConnectorAuditPruneResult = {
    deleted: 0,
    batches: 0,
    isTruncated: false,
  }

  while (true) {
    if (readClockMs() - startedAtMs >= maxRuntimeMs) {
      result.isTruncated = true

      return result
    }

    const expiredIds = input.db
      .select({ id: schema.connectorToolCalls.id })
      .from(schema.connectorToolCalls)
      .where(lt(schema.connectorToolCalls.createdAt, cutoff))
      .orderBy(schema.connectorToolCalls.createdAt)
      .limit(CONNECTOR_AUDIT_PRUNE_BATCH)
    const removed = await input.db.delete(schema.connectorToolCalls)
      .where(inArray(schema.connectorToolCalls.id, expiredIds))
      .returning({ id: schema.connectorToolCalls.id })

    result.batches += 1
    result.deleted += removed.length

    if (removed.length < CONNECTOR_AUDIT_PRUNE_BATCH) {
      return result
    }
  }
}
