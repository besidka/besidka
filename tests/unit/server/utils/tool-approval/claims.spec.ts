import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  claimApproval,
  findClaim,
  isClaimLeaseExpired,
  markClaimDone,
  markClaimFailed,
  sweepToolApprovalClaims,
} = await import('~~/server/utils/tool-approval/claims')

const NOW = new Date('2026-11-15T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

describe('tool approval claims', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let owner: { userId: number, chatPublicId: string, messagePublicId: string }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, userId)

    owner = {
      userId,
      chatPublicId: chat.id,
      messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    }
  })

  afterEach(() => {
    testDb.close()
  })

  describe('claimApproval', () => {
    it('wins the first claim and records it as claimed', async () => {
      expect(await claimApproval(testDb.db, 'approval_one', owner)).toBe(true)

      const claim = await findClaim(testDb.db, 'approval_one', userId)

      expect(claim).toMatchObject({
        approvalId: 'approval_one',
        userId,
        chatPublicId: owner.chatPublicId,
        messagePublicId: owner.messagePublicId,
        status: 'claimed',
      })
    })

    it('loses a second claim of the same approval', async () => {
      expect(await claimApproval(testDb.db, 'approval_one', owner)).toBe(true)
      expect(await claimApproval(testDb.db, 'approval_one', owner)).toBe(false)
    })

    it('has exactly one winner when two claims race', async () => {
      const outcomes = await Promise.all([
        claimApproval(testDb.db, 'approval_race', owner),
        claimApproval(testDb.db, 'approval_race', owner),
      ])

      expect(outcomes.filter(Boolean)).toHaveLength(1)

      const rows = await testDb.db.select().from(schema.toolApprovalClaims)

      expect(rows).toHaveLength(1)
    })

    it('has exactly one winner among many concurrent claims', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => {
          return claimApproval(testDb.db, 'approval_many', owner)
        }),
      )

      expect(outcomes.filter(Boolean)).toHaveLength(1)
    })

    it('does not let another user take over a claimed approval', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)

      expect(await claimApproval(testDb.db, 'approval_one', {
        ...owner,
        userId: otherUserId,
      })).toBe(false)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.userId)
        .toBe(userId)
    })

    it('keeps different approvals independent', async () => {
      expect(await claimApproval(testDb.db, 'approval_a', owner)).toBe(true)
      expect(await claimApproval(testDb.db, 'approval_b', owner)).toBe(true)
    })

    it('does not reopen a finished claim', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)
      await markClaimDone(testDb.db, 'approval_one', userId)

      expect(await claimApproval(testDb.db, 'approval_one', owner)).toBe(false)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.status)
        .toBe('done')
    })
  })

  describe('markClaimDone and markClaimFailed', () => {
    it('moves a claimed approval to done', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)

      expect(await markClaimDone(testDb.db, 'approval_one', userId))
        .toBe(true)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.status)
        .toBe('done')
    })

    it('moves a claimed approval to failed', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)

      expect(await markClaimFailed(testDb.db, 'approval_one', userId))
        .toBe(true)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.status)
        .toBe('failed')
    })

    it('only leaves the claimed state once', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)
      await markClaimDone(testDb.db, 'approval_one', userId)

      expect(await markClaimFailed(testDb.db, 'approval_one', userId))
        .toBe(false)
      expect(await markClaimDone(testDb.db, 'approval_one', userId))
        .toBe(false)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.status)
        .toBe('done')
    })

    it('does nothing for another user or an unknown approval', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)

      expect(await markClaimDone(testDb.db, 'approval_one', otherUserId))
        .toBe(false)
      expect(await markClaimDone(testDb.db, 'approval_none', userId))
        .toBe(false)
      expect((await findClaim(testDb.db, 'approval_one', userId))?.status)
        .toBe('claimed')
    })
  })

  describe('findClaim', () => {
    it('returns null for an unknown approval', async () => {
      expect(await findClaim(testDb.db, 'approval_none', userId)).toBeNull()
    })

    it('hides a claim from another user', async () => {
      await claimApproval(testDb.db, 'approval_one', owner)

      expect(await findClaim(testDb.db, 'approval_one', otherUserId))
        .toBeNull()
    })
  })

  describe('isClaimLeaseExpired', () => {
    it('is false inside the 120 second lease', () => {
      expect(isClaimLeaseExpired(
        { status: 'claimed', createdAt: new Date(NOW.getTime() - 119_000) },
        NOW,
      )).toBe(false)
    })

    it('is true for a claimed approval past the lease', () => {
      expect(isClaimLeaseExpired(
        { status: 'claimed', createdAt: new Date(NOW.getTime() - 121_000) },
        NOW,
      )).toBe(true)
    })

    it('is false for a finished claim however old', () => {
      expect(isClaimLeaseExpired(
        { status: 'done', createdAt: new Date(NOW.getTime() - HOUR_MS) },
        NOW,
      )).toBe(false)
      expect(isClaimLeaseExpired(
        { status: 'failed', createdAt: new Date(NOW.getTime() - HOUR_MS) },
        NOW,
      )).toBe(false)
    })
  })

  describe('sweepToolApprovalClaims', () => {
    async function seedClaim(approvalId: string, hoursOld: number) {
      await testDb.db.insert(schema.toolApprovalClaims).values({
        approvalId,
        userId,
        chatPublicId: owner.chatPublicId,
        messagePublicId: owner.messagePublicId,
        status: 'done',
        createdAt: new Date(NOW.getTime() - hoursOld * HOUR_MS),
      })
    }

    it('deletes claims older than 48 hours and keeps the rest', async () => {
      await seedClaim('approval_old', 49)
      await seedClaim('approval_edge', 47)
      await seedClaim('approval_new', 1)

      const deleted = await sweepToolApprovalClaims({
        db: testDb.db,
        now: NOW,
      })
      const rows = await testDb.db.select().from(schema.toolApprovalClaims)
      const remaining = rows.map(claim => claim.approvalId).sort()

      expect(deleted).toBe(1)
      expect(remaining).toEqual(['approval_edge', 'approval_new'])
    })

    it('deletes old claims whatever their status', async () => {
      await testDb.db.insert(schema.toolApprovalClaims).values({
        approvalId: 'approval_stuck',
        userId,
        chatPublicId: owner.chatPublicId,
        messagePublicId: owner.messagePublicId,
        status: 'claimed',
        createdAt: new Date(NOW.getTime() - 72 * HOUR_MS),
      })

      expect(await sweepToolApprovalClaims({ db: testDb.db, now: NOW }))
        .toBe(1)
    })

    it('drains a backlog over several batches in one run', async () => {
      for (let index = 0; index < 1100; index++) {
        await testDb.db.insert(schema.toolApprovalClaims).values({
          approvalId: `approval_bulk_${index}`,
          userId,
          chatPublicId: owner.chatPublicId,
          messagePublicId: owner.messagePublicId,
          status: 'done',
          createdAt: new Date(NOW.getTime() - 60 * HOUR_MS),
        })
      }

      expect(await sweepToolApprovalClaims({ db: testDb.db, now: NOW }))
        .toBe(1100)
    })

    it('does nothing on an empty table', async () => {
      expect(await sweepToolApprovalClaims({ db: testDb.db, now: NOW }))
        .toBe(0)
    })
  })
})
