import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import { purgeUserLegalNoticeData } from '~~/server/utils/legal/purge'
import {
  createMemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const APPROVED_AT = new Date('2026-11-15T10:00:00.000Z')

describe('purgeUserLegalNoticeData', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('deletes the user opt-out and unlinks the user as an approver',
    async () => {
      await testDb.db.insert(schema.legalNoticeEmailOptOuts).values([
        { userId: 7, source: 'admin', createdBy: 1 },
        { userId: 8, source: 'admin', createdBy: 7 },
      ])
      await testDb.db.insert(schema.legalNoticeApprovals).values({
        noticeId: 'notice',
        noticeHash: 'hash',
        recipientEstimate: 3,
        approvedBy: 7,
        approvedAt: APPROVED_AT,
        withdrawnBy: 7,
        withdrawnAt: APPROVED_AT,
      })
      await testDb.db.insert(schema.legalConsentVersionApprovals).values({
        version: '2026-12-a',
        consentTextSha256: 'sha',
        approvedBy: 7,
        approvedAt: APPROVED_AT,
      })

      const result = await purgeUserLegalNoticeData(7, testDb.db)

      expect(result).toEqual({ legalNoticeOptOutsDeleted: 1 })
      expect(await testDb.db.select({
        userId: schema.legalNoticeEmailOptOuts.userId,
        createdBy: schema.legalNoticeEmailOptOuts.createdBy,
      }).from(schema.legalNoticeEmailOptOuts)).toEqual([
        { userId: 8, createdBy: null },
      ])
      expect(await testDb.db.select({
        approvedBy: schema.legalNoticeApprovals.approvedBy,
        withdrawnBy: schema.legalNoticeApprovals.withdrawnBy,
      }).from(schema.legalNoticeApprovals)).toEqual([
        { approvedBy: null, withdrawnBy: null },
      ])
      expect(await testDb.db.select({
        approvedBy: schema.legalConsentVersionApprovals.approvedBy,
        version: schema.legalConsentVersionApprovals.version,
      }).from(schema.legalConsentVersionApprovals)).toEqual([
        { approvedBy: null, version: '2026-12-a' },
      ])
    })
})
