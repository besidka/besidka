import { isNull } from 'drizzle-orm'
import type { LegalNotice } from '#shared/utils/legal-notices'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

type NoticeApprovalDatabase = Pick<DbClient, 'select'>

export interface ActiveLegalNoticeApproval {
  id: number
  noticeId: string
  noticeHash: string
  recipientEstimate: number
  approvedBy: number | null
  approvedAt: Date
}

export interface ApprovedLegalNotices {
  approved: LegalNotice[]
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

    result.approved.push(notice)
  }

  return result
}
