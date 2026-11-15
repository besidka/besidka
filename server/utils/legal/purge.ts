import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export interface PurgeLegalNoticeDataResult {
  legalNoticeOptOutsDeleted: number
}

type PurgeLegalNoticeDatabase = Pick<
  ReturnType<typeof useDb>,
  'delete' | 'update'
>

/**
 * Removes a user's legal notice email opt-out and the links to them as the
 * approving admin, none of which has a foreign key to `users`. Approvals
 * themselves stay: they record the owner's decision, not the person.
 */
export async function purgeUserLegalNoticeData(
  userId: number,
  database: PurgeLegalNoticeDatabase,
): Promise<PurgeLegalNoticeDataResult> {
  const optOuts = await database
    .delete(schema.legalNoticeEmailOptOuts)
    .where(eq(schema.legalNoticeEmailOptOuts.userId, userId))
    .returning({ id: schema.legalNoticeEmailOptOuts.id })

  await database
    .update(schema.legalNoticeEmailOptOuts)
    .set({ createdBy: null })
    .where(eq(schema.legalNoticeEmailOptOuts.createdBy, userId))
  await database
    .update(schema.legalNoticeApprovals)
    .set({ approvedBy: null })
    .where(eq(schema.legalNoticeApprovals.approvedBy, userId))
  await database
    .update(schema.legalNoticeApprovals)
    .set({ withdrawnBy: null })
    .where(eq(schema.legalNoticeApprovals.withdrawnBy, userId))
  await database
    .update(schema.legalConsentVersionApprovals)
    .set({ approvedBy: null })
    .where(eq(schema.legalConsentVersionApprovals.approvedBy, userId))

  return { legalNoticeOptOutsDeleted: optOuts.length }
}
