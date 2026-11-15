import { and, count, eq, gte, isNull, or } from 'drizzle-orm'
import type { LegalNotice } from '#shared/utils/legal-notices'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

type NoticeApprovalDatabase = Pick<DbClient, 'select'>

type NoticeApprovalCheckDatabase = Pick<DbClient, 'select' | 'batch'>

export interface ActiveLegalNoticeApproval {
  id: number
  noticeId: string
  noticeHash: string
  recipientEstimate: number
  approvedBy: number | null
  approvedAt: Date
}

export interface ApprovedLegalNotice {
  notice: LegalNotice
  approval: ActiveLegalNoticeApproval
}

export type LegalNoticeClaimCheck
  = | 'approved'
    | 'withdrawn'
    | 'exhausted'
    | 'opted-out'

export interface ApprovedLegalNotices {
  approved: ApprovedLegalNotice[]
  unapprovedIds: string[]
  changedIds: string[]
}

/**
 * Hashes everything a notice email says or is timed by, so an approval
 * covers exactly the notice the owner read: any later edit in code to the
 * dates or the summary makes the approval stale and stops the emails.
 */
export async function hashLegalNotice(notice: LegalNotice): Promise<string> {
  return await sha256Hex(JSON.stringify({
    id: notice.id,
    documents: notice.documents,
    publishedAt: notice.publishedAt,
    sendFrom: notice.sendFrom,
    effectiveAt: notice.effectiveAt,
    shortNoticeReason: notice.shortNoticeReason ?? null,
    alreadyAvailable: notice.alreadyAvailable ?? false,
    summary: notice.summary,
  }))
}

export async function readActiveLegalNoticeApprovals(
  db: NoticeApprovalDatabase,
): Promise<Map<string, ActiveLegalNoticeApproval>> {
  const rows = await db
    .select({
      id: schema.legalNoticeApprovals.id,
      noticeId: schema.legalNoticeApprovals.noticeId,
      noticeHash: schema.legalNoticeApprovals.noticeHash,
      recipientEstimate: schema.legalNoticeApprovals.recipientEstimate,
      approvedBy: schema.legalNoticeApprovals.approvedBy,
      approvedAt: schema.legalNoticeApprovals.approvedAt,
    })
    .from(schema.legalNoticeApprovals)
    .where(isNull(schema.legalNoticeApprovals.withdrawnAt))

  return new Map(rows.map((row) => {
    return [row.noticeId, row]
  }))
}

/**
 * Keeps only the notices the owner approved in the admin area and that are
 * unchanged since: a notice with no active approval, or whose content hash
 * no longer matches the approved one, is never emailed.
 */
export async function selectApprovedLegalNotices(
  db: NoticeApprovalDatabase,
  notices: readonly LegalNotice[],
): Promise<ApprovedLegalNotices> {
  const result: ApprovedLegalNotices = {
    approved: [],
    unapprovedIds: [],
    changedIds: [],
  }

  if (notices.length === 0) {
    return result
  }

  const approvals = await readActiveLegalNoticeApprovals(db)

  for (const notice of notices) {
    const approval = approvals.get(notice.id)

    if (!approval) {
      result.unapprovedIds.push(notice.id)

      continue
    }

    if (approval.noticeHash !== await hashLegalNotice(notice)) {
      result.changedIds.push(notice.id)

      continue
    }

    result.approved.push({ notice, approval })
  }

  return result
}

function deliveredSinceApprovalCondition(
  approval: Pick<ActiveLegalNoticeApproval, 'noticeId' | 'approvedAt'>,
) {
  return and(
    eq(schema.legalNoticeDeliveries.noticeId, approval.noticeId),
    or(
      and(
        eq(schema.legalNoticeDeliveries.status, 'sent'),
        gte(schema.legalNoticeDeliveries.sentAt, approval.approvedAt),
      ),
      and(
        eq(schema.legalNoticeDeliveries.status, 'sending'),
        gte(schema.legalNoticeDeliveries.updatedAt, approval.approvedAt),
      ),
    ),
  )
}

/**
 * Deliveries sent or in flight for the notice since it was approved. The
 * approval covers at most `recipientEstimate` of them, the number the owner
 * confirmed.
 */
export async function countDeliveriesSinceApproval(
  db: NoticeApprovalDatabase,
  approval: Pick<ActiveLegalNoticeApproval, 'noticeId' | 'approvedAt'>,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.legalNoticeDeliveries)
    .where(deliveredSinceApprovalCondition(approval))

  return row?.total ?? 0
}

/**
 * Re-checks a claimed delivery right before its send, in one round trip:
 * the approval is still the active one (so its hash is unchanged), the user
 * has not opted out, and the deliveries since the approval, this claim
 * included, stay within the confirmed number of recipients.
 */
export async function checkLegalNoticeClaim(
  db: NoticeApprovalCheckDatabase,
  approval: ActiveLegalNoticeApproval,
  userId: number,
): Promise<LegalNoticeClaimCheck> {
  const [activeRows, optOutRows, deliveredRows] = await db.batch([
    db
      .select({ id: schema.legalNoticeApprovals.id })
      .from(schema.legalNoticeApprovals)
      .where(and(
        eq(schema.legalNoticeApprovals.id, approval.id),
        eq(schema.legalNoticeApprovals.noticeHash, approval.noticeHash),
        isNull(schema.legalNoticeApprovals.withdrawnAt),
      ))
      .limit(1),
    db
      .select({ userId: schema.legalNoticeEmailOptOuts.userId })
      .from(schema.legalNoticeEmailOptOuts)
      .where(eq(schema.legalNoticeEmailOptOuts.userId, userId))
      .limit(1),
    db
      .select({ total: count() })
      .from(schema.legalNoticeDeliveries)
      .where(deliveredSinceApprovalCondition(approval)),
  ])

  if (activeRows.length === 0) {
    return 'withdrawn'
  }

  if (optOutRows.length > 0) {
    return 'opted-out'
  }

  if ((deliveredRows[0]?.total ?? 0) > approval.recipientEstimate) {
    return 'exhausted'
  }

  return 'approved'
}
