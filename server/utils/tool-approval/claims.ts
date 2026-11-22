import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import {
  TOOL_APPROVAL_CLAIM_LEASE_SECONDS,
  TOOL_APPROVAL_CLAIM_RETENTION_HOURS,
  TOOL_APPROVAL_CLAIM_SWEEP_BATCH,
  TOOL_APPROVAL_CLAIM_SWEEP_MAX_BATCHES,
} from '#shared/utils/tool-approval-policy'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export interface ToolApprovalClaimOwner {
  userId: number
  chatPublicId: string
  messagePublicId: string
}

export type ToolApprovalClaim = typeof schema.toolApprovalClaims.$inferSelect

const MILLISECONDS_PER_SECOND = 1000
const MILLISECONDS_PER_HOUR = 60 * 60 * MILLISECONDS_PER_SECOND

/**
 * Takes the one-time right to execute an approved call: a single
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so the statement itself
 * decides the winner. Of two requests carrying the same approval id (a
 * double click, a resend after a killed Worker) exactly one gets a row back.
 * The loser must not execute the call. Reading `RETURNING` rather than the
 * driver's change count behaves the same on D1 and on better-sqlite3.
 *
 * The claim proves nothing about who may use the approval: the owner passed
 * in is only recorded. The caller MUST first load the KV record
 * (`getToolApproval`) and check that its user, chat, message and tool call
 * match the session and the request, and only then claim. A claim taken
 * before that check would let one user burn another user's approval id.
 */
export async function claimApproval(
  db: DbClient,
  approvalId: string,
  owner: ToolApprovalClaimOwner,
): Promise<boolean> {
  const inserted = await db.insert(schema.toolApprovalClaims)
    .values({
      approvalId,
      userId: owner.userId,
      chatPublicId: owner.chatPublicId,
      messagePublicId: owner.messagePublicId,
      status: 'claimed',
    })
    .onConflictDoNothing({ target: schema.toolApprovalClaims.approvalId })
    .returning({ approvalId: schema.toolApprovalClaims.approvalId })

  return inserted.length === 1
}

async function finishClaim(
  db: DbClient,
  approvalId: string,
  userId: number,
  status: 'done' | 'failed',
): Promise<boolean> {
  const updated = await db.update(schema.toolApprovalClaims)
    .set({ status })
    .where(and(
      eq(schema.toolApprovalClaims.approvalId, approvalId),
      eq(schema.toolApprovalClaims.userId, userId),
      eq(schema.toolApprovalClaims.status, 'claimed'),
    ))
    .returning({ approvalId: schema.toolApprovalClaims.approvalId })

  return updated.length === 1
}

/**
 * Heartbeat for a long-running approved call: moves `updatedAt` forward so
 * the lease is measured from the last sign of life rather than from the
 * claim. Returns false when the claim is not `claimed` (already finished) or
 * its lease has already lapsed, so a Worker the lease declared dead cannot
 * revive the claim after the user was told the call was interrupted.
 */
export async function touchClaim(
  db: DbClient,
  approvalId: string,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const leaseCutoff = new Date(
    now.getTime() - TOOL_APPROVAL_CLAIM_LEASE_SECONDS * MILLISECONDS_PER_SECOND,
  )
  const updated = await db.update(schema.toolApprovalClaims)
    .set({ updatedAt: now })
    .where(and(
      eq(schema.toolApprovalClaims.approvalId, approvalId),
      eq(schema.toolApprovalClaims.userId, userId),
      eq(schema.toolApprovalClaims.status, 'claimed'),
      gte(schema.toolApprovalClaims.updatedAt, leaseCutoff),
    ))
    .returning({ approvalId: schema.toolApprovalClaims.approvalId })

  return updated.length === 1
}

export async function markClaimDone(
  db: DbClient,
  approvalId: string,
  userId: number,
): Promise<boolean> {
  return await finishClaim(db, approvalId, userId, 'done')
}

export async function markClaimFailed(
  db: DbClient,
  approvalId: string,
  userId: number,
): Promise<boolean> {
  return await finishClaim(db, approvalId, userId, 'failed')
}

/**
 * Ends the lease of the claims a stopped continuation still holds, so a
 * retry of the same answers is told at once that the call was interrupted
 * (it may or may not have run, so it never runs again) instead of waiting
 * up to the full lease as "still working". The pending approval records
 * were deleted when the answers were claimed, so releasing the claims for a
 * fresh run is not possible. Claims that already recorded a result are left
 * alone. Returns how many claims it expired.
 */
export async function expireUnfinishedClaims(
  db: DbClient,
  approvalIds: readonly string[],
  userId: number,
  now: Date = new Date(),
): Promise<number> {
  if (approvalIds.length === 0) {
    return 0
  }

  const expiredAt = new Date(
    now.getTime()
    - (TOOL_APPROVAL_CLAIM_LEASE_SECONDS + 1) * MILLISECONDS_PER_SECOND,
  )
  const updated = await db.update(schema.toolApprovalClaims)
    .set({ updatedAt: expiredAt })
    .where(and(
      inArray(schema.toolApprovalClaims.approvalId, [...approvalIds]),
      eq(schema.toolApprovalClaims.userId, userId),
      eq(schema.toolApprovalClaims.status, 'claimed'),
    ))
    .returning({ approvalId: schema.toolApprovalClaims.approvalId })

  return updated.length
}

export async function findClaim(
  db: DbClient,
  approvalId: string,
  userId: number,
): Promise<ToolApprovalClaim | null> {
  const [claim] = await db.select()
    .from(schema.toolApprovalClaims)
    .where(and(
      eq(schema.toolApprovalClaims.approvalId, approvalId),
      eq(schema.toolApprovalClaims.userId, userId),
    ))
    .limit(1)

  return claim ?? null
}

/**
 * A claim that is still `claimed` and has not been touched for the lease
 * means the Worker that took it died before it recorded a result. The lease
 * runs from `updatedAt`, which `touchClaim` moves while the call is alive.
 * The call may or may not have run, so it is never executed again: the user
 * is told it was interrupted.
 */
export function isClaimLeaseExpired(
  claim: Pick<ToolApprovalClaim, 'status' | 'updatedAt'>,
  now: Date,
): boolean {
  return claim.status === 'claimed'
    && now.getTime() - claim.updatedAt.getTime()
    > TOOL_APPROVAL_CLAIM_LEASE_SECONDS * MILLISECONDS_PER_SECOND
}

/**
 * Deletes claims older than 48 hours, at most 500 per batch and ten batches
 * per run; a backlog drains over the next runs. A claim only has to outlive
 * the 24 hour life of the KV approval record it guards.
 */
export async function sweepToolApprovalClaims(input: {
  db: DbClient
  now: Date
}): Promise<number> {
  const cutoff = new Date(
    input.now.getTime()
    - TOOL_APPROVAL_CLAIM_RETENTION_HOURS * MILLISECONDS_PER_HOUR,
  )
  let deleted = 0

  for (
    let batchIndex = 0;
    batchIndex < TOOL_APPROVAL_CLAIM_SWEEP_MAX_BATCHES;
    batchIndex++
  ) {
    const expiredIds = input.db
      .select({ approvalId: schema.toolApprovalClaims.approvalId })
      .from(schema.toolApprovalClaims)
      .where(lt(schema.toolApprovalClaims.createdAt, cutoff))
      .orderBy(schema.toolApprovalClaims.createdAt)
      .limit(TOOL_APPROVAL_CLAIM_SWEEP_BATCH)
    const removed = await input.db.delete(schema.toolApprovalClaims)
      .where(inArray(schema.toolApprovalClaims.approvalId, expiredIds))
      .returning({ approvalId: schema.toolApprovalClaims.approvalId })

    deleted += removed.length

    if (removed.length < TOOL_APPROVAL_CLAIM_SWEEP_BATCH) {
      break
    }
  }

  return deleted
}
