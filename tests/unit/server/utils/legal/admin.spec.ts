import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc } from 'drizzle-orm'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import * as schema from '~~/server/db/schema'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import {
  addLegalNoticeOptOut,
  approveConsentVersion,
  approveLegalNotice,
  getLegalAdminOverview,
  removeLegalNoticeOptOut,
  withdrawLegalNoticeApproval,
} from '~~/server/utils/legal/admin'
import {
  APPROVED_CONSENT_VERSION_CACHE_KEY,
  getCachedApprovedConsentVersion,
  resetApprovedConsentVersionMemo,
} from '~~/server/utils/legal/consent-version'
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

vi.mock('~~/server/utils/legal/consent', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/legal/consent')
  >()

  return {
    ...original,
    CURRENT_CONSENT_VERSION: '2026-12-a',
  }
})

const NOTICE = LEGAL_NOTICES[0]
const BEFORE_PUBLISHED = new Date('2026-10-01T00:00:00.000Z')
const IN_WINDOW = new Date('2026-11-02T10:00:00.000Z')
const AFTER_EFFECTIVE = new Date('2026-12-05T00:00:00.000Z')

describe('legal admin writers', () => {
  let testDb: MemoryExtractionTestDb
  let kvStore: Map<string, string>
  let logger: { set: ReturnType<typeof vi.fn> }
  let userSequence = 0

  function createContext(
    overrides: Partial<FeatureAdminContext> = {},
  ): FeatureAdminContext {
    return {
      db: testDb.db,
      kv: {
        get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kvStore.set(key, value)
        }),
        delete: vi.fn(),
      } as unknown as FeatureAdminContext['kv'],
      actor: { userId: 1, kind: 'ui' },
      rolloutEnabled: false,
      logger,
      now: IN_WINDOW,
      ...overrides,
    }
  }

  async function seedUser(): Promise<number> {
    userSequence += 1

    const [user] = await testDb.db.insert(schema.users).values({
      name: `User ${userSequence}`,
      email: `user-${userSequence}@example.test`,
      emailVerified: true,
      createdAt: BEFORE_PUBLISHED,
    }).returning({ id: schema.users.id })

    return user!.id
  }

  async function readAudit() {
    return await testDb.db
      .select()
      .from(schema.featureAuditLog)
      .orderBy(asc(schema.featureAuditLog.id))
  }

  async function readApprovals() {
    return await testDb.db
      .select()
      .from(schema.legalNoticeApprovals)
      .orderBy(asc(schema.legalNoticeApprovals.id))
  }

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    kvStore = new Map()
    logger = { set: vi.fn() }
    userSequence = 0
    resetApprovedConsentVersionMemo()
  })

  afterEach(() => {
    testDb.close()
    resetApprovedConsentVersionMemo()
  })

  describe('approveLegalNotice', () => {
    it('stores the approval with its hash and an audit row', async () => {
      await seedUser()
      await seedUser()

      const result = await approveLegalNotice(createContext(), NOTICE.id, {
        recipientEstimate: 2,
      })
      const [approval] = await readApprovals()
      const [audit] = await readAudit()

      expect(result).toEqual({
        noticeId: NOTICE.id,
        approvedAt: IN_WINDOW.toISOString(),
        recipientEstimate: 2,
      })
      expect(approval).toMatchObject({
        noticeId: NOTICE.id,
        recipientEstimate: 2,
        approvedBy: 1,
        withdrawnAt: null,
      })
      expect(approval?.noticeHash).toMatch(/^[0-9a-f]{64}$/)
      expect(audit).toMatchObject({
        actorUserId: 1,
        actorKind: 'ui',
        action: 'legal-notice.approve',
        flag: null,
        targetUserId: null,
        before: null,
        after: {
          noticeId: NOTICE.id,
          noticeHash: approval?.noticeHash,
          recipientEstimate: 2,
        },
      })
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          legalAdmin: {
            action: 'legal-notice.approve',
            noticeId: NOTICE.id,
            recipientEstimate: 2,
            actorKind: 'ui',
          },
        },
      })
    })

    it('refuses when the confirmed recipient count is out of date',
      async () => {
        await seedUser()

        await expect(approveLegalNotice(createContext(), NOTICE.id, {
          recipientEstimate: 0,
        })).rejects.toMatchObject({ status: 409 })
        expect(await readApprovals()).toEqual([])
        expect(await readAudit()).toEqual([])
      })

    it('refuses a second approval while one is active', async () => {
      await approveLegalNotice(createContext(), NOTICE.id, {
        recipientEstimate: 0,
      })

      await expect(approveLegalNotice(createContext(), NOTICE.id, {
        recipientEstimate: 0,
      })).rejects.toMatchObject({ status: 409 })
      expect(await readApprovals()).toHaveLength(1)
    })

    it('refuses a notice that is already in effect', async () => {
      await expect(approveLegalNotice(
        createContext({ now: AFTER_EFFECTIVE }),
        NOTICE.id,
        { recipientEstimate: 0 },
      )).rejects.toMatchObject({ status: 409 })
    })

    it('refuses an unknown notice', async () => {
      await expect(approveLegalNotice(createContext(), 'no-such-notice', {
        recipientEstimate: 0,
      })).rejects.toMatchObject({ status: 404 })
    })

    it.each(['mcp', 'schedule'] as const)(
      'refuses an approval from %s',
      async (kind) => {
        await expect(approveLegalNotice(
          createContext({ actor: { userId: 1, kind } }),
          NOTICE.id,
          { recipientEstimate: 0 },
        )).rejects.toMatchObject({ status: 403 })
        expect(await readApprovals()).toEqual([])
      },
    )
  })

  describe('withdrawLegalNoticeApproval', () => {
    it('marks the approval withdrawn and audits it', async () => {
      const context = createContext()

      await approveLegalNotice(context, NOTICE.id, { recipientEstimate: 0 })
      await withdrawLegalNoticeApproval(context, NOTICE.id)

      const [approval] = await readApprovals()
      const audit = await readAudit()

      expect(approval).toMatchObject({
        withdrawnAt: IN_WINDOW,
        withdrawnBy: 1,
      })
      expect(audit.map((row) => {
        return row.action
      })).toEqual(['legal-notice.approve', 'legal-notice.withdraw'])
    })

    it('allows a new approval after a withdrawal', async () => {
      const context = createContext()

      await approveLegalNotice(context, NOTICE.id, { recipientEstimate: 0 })
      await withdrawLegalNoticeApproval(context, NOTICE.id)
      await approveLegalNotice(context, NOTICE.id, { recipientEstimate: 0 })

      expect(await readApprovals()).toHaveLength(2)
    })

    it('answers 404 when the notice is not approved', async () => {
      await expect(withdrawLegalNoticeApproval(createContext(), NOTICE.id))
        .rejects.toMatchObject({ status: 404 })
    })
  })

  describe('approveConsentVersion', () => {
    it('approves the code version, audits it and updates the caches',
      async () => {
        const result = await approveConsentVersion(createContext(), {
          version: '2026-12-a',
        })
        const [audit] = await readAudit()

        expect(result).toMatchObject({
          version: '2026-12-a',
          previousVersion: '2026-11-a',
        })
        expect(audit).toMatchObject({
          action: 'legal-consent-version.approve',
          before: { version: '2026-11-a' },
          after: { version: '2026-12-a' },
        })
        expect(getCachedApprovedConsentVersion()).toBe('2026-12-a')
        expect(kvStore.get(APPROVED_CONSENT_VERSION_CACHE_KEY))
          .toBe('2026-12-a')
      })

    it('refuses a version that is not the one in code', async () => {
      await expect(approveConsentVersion(createContext(), {
        version: '2027-01-a',
      })).rejects.toMatchObject({ status: 409 })
      expect(await readAudit()).toEqual([])
    })

    it('refuses a version that is already approved', async () => {
      await approveConsentVersion(createContext(), { version: '2026-12-a' })

      await expect(approveConsentVersion(createContext(), {
        version: '2026-12-a',
      })).rejects.toMatchObject({ status: 409 })
    })

    it('refuses an approval that does not come from the admin UI',
      async () => {
        await expect(approveConsentVersion(
          createContext({ actor: { userId: 1, kind: 'mcp' } }),
          { version: '2026-12-a' },
        )).rejects.toMatchObject({ status: 403 })
      })
  })

  describe('legal notice opt-outs', () => {
    it('adds and removes an opt-out with the user as the audit target',
      async () => {
        const userId = await seedUser()
        const context = createContext()

        await expect(addLegalNoticeOptOut(context, { userId }))
          .resolves.toEqual({ userId, changed: true })
        await expect(addLegalNoticeOptOut(context, { userId }))
          .resolves.toEqual({ userId, changed: false })
        await expect(removeLegalNoticeOptOut(context, userId))
          .resolves.toEqual({ userId, changed: true })

        const audit = await readAudit()

        expect(audit.map((row) => {
          return [row.action, row.targetUserId]
        })).toEqual([
          ['legal-notice-opt-out.add', userId],
          ['legal-notice-opt-out.remove', userId],
        ])
        expect(await testDb.db.select()
          .from(schema.legalNoticeEmailOptOuts)).toEqual([])
      })

    it('answers 404 for an unknown user or a missing opt-out', async () => {
      await expect(addLegalNoticeOptOut(createContext(), { userId: 999 }))
        .rejects.toMatchObject({ status: 404 })
      await expect(removeLegalNoticeOptOut(createContext(), 999))
        .rejects.toMatchObject({ status: 404 })
    })
  })

  describe('getLegalAdminOverview', () => {
    it('shows notices, recipients, consent versions and opt-outs',
      async () => {
        const approver = await seedUser()
        const optedOut = await seedUser()

        await addLegalNoticeOptOut(createContext(), { userId: optedOut })
        await approveLegalNotice(createContext(), NOTICE.id, {
          recipientEstimate: 1,
        })

        const overview = await getLegalAdminOverview(testDb.db, {
          sweepEnabled: false,
          now: IN_WINDOW,
        })
        const notice = overview.notices.find((item) => {
          return item.id === NOTICE.id
        })

        expect(overview.sweepEnabled).toBe(false)
        expect(overview.notices).toHaveLength(LEGAL_NOTICES.length)
        expect(notice).toMatchObject({
          windowState: 'open',
          recipientsNow: 1,
          approval: {
            state: 'approved',
            recipientEstimate: 1,
            approvedByEmail: `user-${approver}@example.test`,
          },
        })
        expect(overview.consent).toMatchObject({
          codeVersion: '2026-12-a',
          approvedVersion: '2026-11-a',
          effectiveVersion: '2026-11-a',
          isCodeVersionApproved: false,
        })
        expect(overview.optOuts).toEqual([
          expect.objectContaining({ userId: optedOut, source: 'admin' }),
        ])
      })
  })
})
