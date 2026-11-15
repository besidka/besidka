import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { LegalNotice } from '#shared/utils/legal-notices'
import * as schema from '~~/server/db/schema'
import {
  LEGAL_NOTICE_FAILED_BACKOFF_MS,
  LEGAL_NOTICE_STALE_SENDING_MS,
  countLegalNoticeRecipients,
  getNoticesInSendWindow,
  sweepLegalNotices,
} from '~~/server/utils/legal/notice-sweep'
import { hashLegalNotice } from '~~/server/utils/legal/notice-approvals'
import {
  createMemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const NOW = new Date('2026-11-02T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-10-31T06:00:00.000Z')
const BEFORE_PUBLISHED = new Date('2026-10-01T00:00:00.000Z')
const AFTER_PUBLISHED = new Date('2026-11-01T00:00:00.000Z')

const NOTICE: LegalNotice = {
  id: '2026-11-test-notice',
  documents: ['privacy-policy', 'terms-of-use'],
  publishedAt: '2026-10-31T06:00:00Z',
  sendFrom: '2026-10-31T09:00:00Z',
  effectiveAt: '2026-12-04',
  summary: ['I changed something.'],
}

const SECOND_NOTICE: LegalNotice = {
  id: '2026-12-test-second-notice',
  documents: ['cookie-policy'],
  publishedAt: '2026-11-01T06:00:00Z',
  sendFrom: '2026-11-01T09:00:00Z',
  effectiveAt: '2026-12-15',
  summary: ['I changed something else.'],
}

function minutesBefore(minutes: number, from = NOW): Date {
  return new Date(from.getTime() - minutes * 60 * 1000)
}

function codedError(code: string): Error {
  return Object.assign(new Error(`binding failed: ${code}`), { code })
}

describe('getNoticesInSendWindow', () => {
  it('keeps notices from sendFrom until effectiveAt, oldest first', () => {
    const notices = [SECOND_NOTICE, NOTICE]

    expect(getNoticesInSendWindow(notices, NOW).map((notice) => {
      return notice.id
    })).toEqual([NOTICE.id, SECOND_NOTICE.id])
  })

  it('excludes a notice before sendFrom and from the effective instant', () => {
    expect(getNoticesInSendWindow(
      [NOTICE],
      new Date('2026-10-31T08:59:59Z'),
    )).toEqual([])
    expect(getNoticesInSendWindow(
      [NOTICE],
      new Date('2026-10-31T09:00:00Z'),
    )).toHaveLength(1)
    expect(getNoticesInSendWindow(
      [NOTICE],
      new Date('2026-12-04T00:00:00Z'),
    )).toEqual([])
  })
})

describe('sweepLegalNotices', () => {
  let testDb: MemoryExtractionTestDb
  let userSequence = 0
  const sendNotice = vi.fn()
  const renderNotice = vi.fn()

  async function seedRecipient(values: {
    createdAt?: Date
    emailVerified?: boolean
  } = {}): Promise<number> {
    userSequence += 1

    const [user] = await testDb.db.insert(schema.users).values({
      name: `Recipient ${userSequence}`,
      email: `recipient-${userSequence}@example.test`,
      emailVerified: values.emailVerified ?? true,
      createdAt: values.createdAt ?? BEFORE_PUBLISHED,
    }).returning({ id: schema.users.id })

    return user!.id
  }

  async function seedDelivery(
    userId: number,
    values: Partial<typeof schema.legalNoticeDeliveries.$inferInsert>,
  ): Promise<void> {
    await testDb.db.insert(schema.legalNoticeDeliveries).values({
      userId,
      noticeId: NOTICE.id,
      status: 'failed',
      attempts: 1,
      updatedAt: minutesBefore(120),
      ...values,
    })
  }

  async function approveNotice(
    notice: LegalNotice,
    values: Partial<typeof schema.legalNoticeApprovals.$inferInsert> = {},
  ): Promise<void> {
    await testDb.db.insert(schema.legalNoticeApprovals).values({
      noticeId: notice.id,
      noticeHash: await hashLegalNotice(notice),
      recipientEstimate: 1000,
      approvedBy: 1,
      approvedAt: minutesBefore(60),
      ...values,
    })
  }

  async function optOut(userId: number): Promise<void> {
    await testDb.db.insert(schema.legalNoticeEmailOptOuts).values({
      userId,
      source: 'admin',
      createdBy: 1,
    })
  }

  async function readDeliveries() {
    return await testDb.db
      .select()
      .from(schema.legalNoticeDeliveries)
      .orderBy(asc(schema.legalNoticeDeliveries.userId))
  }

  async function readDelivery(userId: number) {
    const [row] = await testDb.db
      .select()
      .from(schema.legalNoticeDeliveries)
      .where(eq(schema.legalNoticeDeliveries.userId, userId))

    return row
  }

  type SweepInput = Parameters<typeof sweepLegalNotices>[0]

  function sweep(overrides: Partial<SweepInput> = {}) {
    return sweepLegalNotices({
      batchSize: 25,
      maxRuntimeMs: 60_000,
      dailyCap: 300,
      privacyEmail: 'privacy@example.test',
      db: testDb.db,
      now: () => NOW,
      notices: [NOTICE],
      renderNotice,
      sendNotice,
      ...overrides,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userSequence = 0
    await approveNotice(NOTICE)
    await approveNotice(SECOND_NOTICE)
    renderNotice.mockReset()
    renderNotice.mockResolvedValue({
      html: '<p>The notice</p>',
      text: 'The notice',
    })
    sendNotice.mockReset()
    sendNotice.mockImplementation(async ({ to }: { to: string }) => {
      return { messageId: `message-${to}` }
    })
  })

  afterEach(() => {
    testDb.close()
  })

  describe('owner approval', () => {
    it('sends nothing for a notice in its window without an approval',
      async () => {
        await testDb.db.delete(schema.legalNoticeApprovals)
        await seedRecipient()

        const result = await sweep()

        expect(result.stopReason).toBe('no-approved-notice')
        expect(result.unapprovedNoticeIds).toEqual([NOTICE.id])
        expect(result.selectedCount).toBe(0)
        expect(sendNotice).not.toHaveBeenCalled()
        expect(renderNotice).not.toHaveBeenCalled()
        expect(await readDeliveries()).toEqual([])
      })

    it('sends only the approved notice when two are in their window',
      async () => {
        await testDb.db
          .delete(schema.legalNoticeApprovals)
          .where(eq(schema.legalNoticeApprovals.noticeId, NOTICE.id))
        await seedRecipient()

        const result = await sweep({ notices: [NOTICE, SECOND_NOTICE] })

        expect(result.unapprovedNoticeIds).toEqual([NOTICE.id])
        expect(result.notices.map((notice) => {
          return notice.noticeId
        })).toEqual([SECOND_NOTICE.id])
        expect((await readDeliveries()).map((row) => {
          return row.noticeId
        })).toEqual([SECOND_NOTICE.id])
      })

    it('stops sending once the approval is withdrawn', async () => {
      await seedRecipient()
      await seedRecipient()

      const first = await sweep({ batchSize: 1 })

      await testDb.db
        .update(schema.legalNoticeApprovals)
        .set({ withdrawnAt: NOW, withdrawnBy: 1 })
        .where(eq(schema.legalNoticeApprovals.noticeId, NOTICE.id))

      const second = await sweep({ batchSize: 1 })

      expect(first.sentCount).toBe(1)
      expect(second.stopReason).toBe('no-approved-notice')
      expect(second.sentCount).toBe(0)
      expect(sendNotice).toHaveBeenCalledTimes(1)
      expect(await readDeliveries()).toHaveLength(1)
    })

    it('sends nothing for a notice changed in code after its approval',
      async () => {
        await seedRecipient()

        const changedNotice: LegalNotice = {
          ...NOTICE,
          summary: ['A different text than the one approved.'],
        }
        const result = await sweep({ notices: [changedNotice] })

        expect(result.stopReason).toBe('no-approved-notice')
        expect(result.changedNoticeIds).toEqual([NOTICE.id])
        expect(sendNotice).not.toHaveBeenCalled()
      })

    it('never mails a user with a legal notice email opt-out', async () => {
      const optedOut = await seedRecipient()
      const recipient = await seedRecipient()

      await optOut(optedOut)

      const result = await sweep()

      expect(result.sentCount).toBe(1)
      expect((await readDeliveries()).map((row) => {
        return row.userId
      })).toEqual([recipient])
      expect(sendNotice).toHaveBeenCalledTimes(1)
      expect(sendNotice).toHaveBeenCalledWith(expect.objectContaining({
        to: `recipient-${recipient}@example.test`,
      }))
    })

    it('stops once the confirmed number of recipients is reached',
      async () => {
        await testDb.db.delete(schema.legalNoticeApprovals)
        await approveNotice(NOTICE, { recipientEstimate: 1 })
        await seedRecipient()
        await seedRecipient()

        const first = await sweep()
        const second = await sweep()

        expect(first.sentCount).toBe(1)
        expect(first.selectedCount).toBe(1)
        expect(second.sentCount).toBe(0)
        expect(second.exhaustedNoticeIds).toEqual([NOTICE.id])
        expect(sendNotice).toHaveBeenCalledTimes(1)
        expect(await readDeliveries()).toHaveLength(1)
      })

    it('does not count deliveries sent before the approval', async () => {
      const earlier = await seedRecipient()
      await seedRecipient()
      await seedDelivery(earlier, {
        status: 'sent',
        sentAt: minutesBefore(24 * 60),
      })
      await testDb.db.delete(schema.legalNoticeApprovals)
      await approveNotice(NOTICE, { recipientEstimate: 1 })

      const result = await sweep()

      expect(result.sentCount).toBe(1)
      expect(result.exhaustedNoticeIds).toEqual([])
    })

    it('never exceeds the confirmed number when two ticks overlap',
      async () => {
        await testDb.db.delete(schema.legalNoticeApprovals)
        await approveNotice(NOTICE, { recipientEstimate: 2 })
        await seedRecipient()
        await seedRecipient()
        await seedRecipient()

        const [first, second] = await Promise.all([sweep(), sweep()])

        expect(first.sentCount + second.sentCount).toBeLessThanOrEqual(2)
        expect(sendNotice.mock.calls.length).toBeLessThanOrEqual(2)
      })

    it('withholds a send when another tick used up the confirmed number',
      async () => {
        await testDb.db.delete(schema.legalNoticeApprovals)
        await approveNotice(NOTICE, { recipientEstimate: 2 })
        await seedRecipient()
        const second = await seedRecipient()
        const elsewhere = await seedRecipient({ emailVerified: false })

        sendNotice.mockImplementationOnce(async () => {
          await seedDelivery(elsewhere, { status: 'sent', sentAt: NOW })

          return { messageId: 'first' }
        })

        const result = await sweep()

        expect(sendNotice).toHaveBeenCalledTimes(1)
        expect(result.exhaustedNoticeIds).toEqual([NOTICE.id])
        expect(result.errorCodes).toEqual({ E_APPROVAL_EXHAUSTED: 1 })
        expect(await readDelivery(second)).toBeUndefined()
      })

    it('stops the next send when the approval is withdrawn mid-tick',
      async () => {
        await seedRecipient()
        const second = await seedRecipient()

        sendNotice.mockImplementationOnce(async () => {
          await testDb.db
            .update(schema.legalNoticeApprovals)
            .set({ withdrawnAt: NOW, withdrawnBy: 1 })
            .where(eq(schema.legalNoticeApprovals.noticeId, NOTICE.id))

          return { messageId: 'first' }
        })

        const result = await sweep()

        expect(sendNotice).toHaveBeenCalledTimes(1)
        expect(result.sentCount).toBe(1)
        expect(result.withheldCount).toBe(1)
        expect(result.errorCodes).toEqual({ E_APPROVAL_WITHDRAWN: 1 })
        expect(await readDelivery(second)).toBeUndefined()
      })

    it('skips a user who opts out mid-tick and mails the rest', async () => {
      await seedRecipient()
      const optingOut = await seedRecipient()
      const last = await seedRecipient()

      sendNotice.mockImplementationOnce(async () => {
        await optOut(optingOut)

        return { messageId: 'first' }
      })

      const result = await sweep()

      expect(result.sentCount).toBe(2)
      expect(result.withheldCount).toBe(1)
      expect(await readDelivery(optingOut)).toBeUndefined()
      expect(await readDelivery(last)).toMatchObject({ status: 'sent' })
    })

    it('stops with an error and sends nothing when approvals cannot be read',
      async () => {
        await seedRecipient()
        testDb.sqlite.exec('DROP TABLE legal_notice_approvals')

        const result = await sweep()

        expect(result.stopReason).toBe('error')
        expect(sendNotice).not.toHaveBeenCalled()
      })
  })

  describe('countLegalNoticeRecipients', () => {
    it('counts the users the sweep would mail now', async () => {
      const sent = await seedRecipient()
      const optedOut = await seedRecipient()
      await seedRecipient()
      await seedRecipient({ emailVerified: false })
      await seedRecipient({ createdAt: AFTER_PUBLISHED })
      await seedDelivery(sent, { status: 'sent', sentAt: minutesBefore(30) })
      await optOut(optedOut)

      expect(await countLegalNoticeRecipients(testDb.db, NOTICE, NOW))
        .toBe(1)
    })

    it('counts nobody once every user has a skipped delivery', async () => {
      const first = await seedRecipient()
      const second = await seedRecipient()
      await seedDelivery(first, {
        status: 'skipped',
        lastErrorCode: 'E_OWNER_STOPPED',
      })
      await seedDelivery(second, {
        status: 'skipped',
        lastErrorCode: 'E_OWNER_STOPPED',
      })

      expect(await countLegalNoticeRecipients(testDb.db, NOTICE, NOW))
        .toBe(0)
    })
  })

  describe('selection', () => {
    it('mails only verified accounts created before publishedAt', async () => {
      const oldVerified = await seedRecipient()
      await seedRecipient({ emailVerified: false })
      await seedRecipient({ createdAt: AFTER_PUBLISHED })
      await seedRecipient({ createdAt: PUBLISHED_AT })

      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect(result.sentCount).toBe(1)
      expect((await readDeliveries()).map((row) => {
        return row.userId
      })).toEqual([oldVerified])
    })

    it('goes in users.id order and respects the batch size', async () => {
      const first = await seedRecipient()
      const second = await seedRecipient()
      await seedRecipient()

      const result = await sweep({ batchSize: 2 })

      expect(result.selectedCount).toBe(2)
      expect((await readDeliveries()).map((row) => {
        return row.userId
      })).toEqual([first, second])
    })

    it('does nothing outside the notice window', async () => {
      await seedRecipient()

      const early = await sweep({ now: () => new Date('2026-10-31T08:00:00Z') })
      const late = await sweep({ now: () => new Date('2026-12-04T00:00:00Z') })

      expect(early.stopReason).toBe('no-active-notice')
      expect(late.stopReason).toBe('no-active-notice')
      expect(sendNotice).not.toHaveBeenCalled()
      expect(await readDeliveries()).toEqual([])
    })

    it('processes the oldest notice first and fills one batch in total',
      async () => {
        await seedRecipient()
        await seedRecipient()
        await seedRecipient()

        const result = await sweep({
          batchSize: 4,
          notices: [SECOND_NOTICE, NOTICE],
        })

        expect(result.notices.map((entry) => {
          return [entry.noticeId, entry.selectedCount]
        })).toEqual([
          [NOTICE.id, 3],
          [SECOND_NOTICE.id, 1],
        ])
      })

    it('stops without sending when the privacy address is not configured',
      async () => {
        await seedRecipient()

        const result = await sweep({ privacyEmail: '' })

        expect(result.stopReason).toBe('privacy-email-missing')
        expect(sendNotice).not.toHaveBeenCalled()
        expect(await readDeliveries()).toEqual([])
      })
  })

  describe('sending', () => {
    it('sends the notice content and records the delivery', async () => {
      const userId = await seedRecipient()

      const result = await sweep()

      expect(sendNotice).toHaveBeenCalledTimes(1)
      expect(sendNotice).toHaveBeenCalledWith(expect.objectContaining({
        to: 'recipient-1@example.test',
        subject: 'Changes to Besidka\'s Privacy Policy and Terms of Use '
          + 'take effect on 4 December 2026',
        html: '<p>The notice</p>',
        text: 'The notice',
      }))
      expect(renderNotice).toHaveBeenCalledWith(expect.objectContaining({
        contactEmail: 'privacy@example.test',
      }))
      expect(result).toMatchObject({
        sentCount: 1,
        failedCount: 0,
        stopReason: 'completed',
      })
      expect(await readDelivery(userId)).toMatchObject({
        noticeId: NOTICE.id,
        status: 'sent',
        attempts: 1,
        messageId: 'message-recipient-1@example.test',
        lastErrorCode: null,
        sentAt: NOW,
      })
    })

    it('never mails the same user twice across ticks', async () => {
      await seedRecipient()
      await seedRecipient()

      await sweep()
      const second = await sweep()

      expect(sendNotice).toHaveBeenCalledTimes(2)
      expect(second.selectedCount).toBe(0)
    })

    it('never mails a user twice when two ticks overlap', async () => {
      await seedRecipient()
      await seedRecipient()
      await seedRecipient()

      let renderCalls = 0
      let releaseRenders: () => void = () => {}
      const bothTicksSelected = new Promise<void>((resolve) => {
        releaseRenders = resolve
      })

      renderNotice.mockImplementation(async () => {
        renderCalls += 1

        if (renderCalls === 2) {
          releaseRenders()
        }

        await bothTicksSelected

        return { html: '<p>The notice</p>', text: 'The notice' }
      })

      const [first, second] = await Promise.all([sweep(), sweep()])

      expect(sendNotice).toHaveBeenCalledTimes(3)
      expect(first.sentCount + second.sentCount).toBe(3)
      expect(first.claimMissedCount + second.claimMissedCount)
        .toBeGreaterThan(0)

      const recipients = sendNotice.mock.calls.map(([input]) => {
        return input.to
      })

      expect(new Set(recipients).size).toBe(3)
    })

    it('renders the email once per notice per tick for all recipients',
      async () => {
        await seedRecipient()
        await seedRecipient()
        await seedRecipient()

        await sweep()

        expect(renderNotice).toHaveBeenCalledTimes(1)
        expect(sendNotice).toHaveBeenCalledTimes(3)

        const bodies = sendNotice.mock.calls.map(([input]) => {
          return [input.html, input.text]
        })

        expect(new Set(bodies.map(String)).size).toBe(1)
      })

    it('renders once for each notice that has recipients', async () => {
      await seedRecipient()
      await seedRecipient()

      await sweep({ notices: [NOTICE, SECOND_NOTICE] })

      expect(sendNotice).toHaveBeenCalledTimes(4)
      expect(renderNotice).toHaveBeenCalledTimes(2)
    })

    it('does not render when there is nobody to mail', async () => {
      await sweep()

      expect(renderNotice).not.toHaveBeenCalled()
    })

    it('stops with an error, without claiming anyone, when rendering fails',
      async () => {
        await seedRecipient()
        renderNotice.mockRejectedValueOnce(new Error('template exploded'))

        const logger = { set: vi.fn() }
        const result = await sweep({ logger })

        expect(result.stopReason).toBe('error')
        expect(sendNotice).not.toHaveBeenCalled()
        expect(await readDeliveries()).toEqual([])
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            legalNoticeSweepError: {
              phase: 'render',
              noticeId: NOTICE.id,
              message: 'template exploded',
            },
          },
        })
      })

    it('does not log or return an address or name', async () => {
      await seedRecipient()

      const logger = { set: vi.fn() }
      const result = await sweep({ logger })

      expect(JSON.stringify(result)).not.toContain('@')
      expect(JSON.stringify(result)).not.toContain('Recipient')
      expect(logger.set).not.toHaveBeenCalled()
    })
  })

  describe('retries', () => {
    it('skips sent and skipped rows and rows still in flight', async () => {
      const sent = await seedRecipient()
      const skipped = await seedRecipient()
      const inFlight = await seedRecipient()
      const freshFailed = await seedRecipient()
      await seedDelivery(sent, { status: 'sent', sentAt: minutesBefore(500) })
      await seedDelivery(skipped, { status: 'skipped' })
      await seedDelivery(inFlight, {
        status: 'sending',
        updatedAt: minutesBefore(
          LEGAL_NOTICE_STALE_SENDING_MS / 60_000 - 1,
        ),
      })
      await seedDelivery(freshFailed, {
        status: 'failed',
        updatedAt: minutesBefore(
          LEGAL_NOTICE_FAILED_BACKOFF_MS / 60_000 - 1,
        ),
      })

      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(sendNotice).not.toHaveBeenCalled()
    })

    it('retries a failed row once its backoff has passed', async () => {
      const userId = await seedRecipient()
      await seedDelivery(userId, {
        status: 'failed',
        attempts: 1,
        lastErrorCode: 'E_UNKNOWN',
        updatedAt: minutesBefore(
          LEGAL_NOTICE_FAILED_BACKOFF_MS / 60_000 + 1,
        ),
      })

      const result = await sweep()

      expect(result.sentCount).toBe(1)
      expect(await readDelivery(userId)).toMatchObject({
        status: 'sent',
        attempts: 2,
        lastErrorCode: null,
      })
    })

    it('retries a sending row older than an hour as a dead send', async () => {
      const userId = await seedRecipient()
      await seedDelivery(userId, {
        status: 'sending',
        attempts: 1,
        updatedAt: minutesBefore(
          LEGAL_NOTICE_STALE_SENDING_MS / 60_000 + 1,
        ),
      })

      const result = await sweep()

      expect(result.sentCount).toBe(1)
      expect(await readDelivery(userId)).toMatchObject({
        status: 'sent',
        attempts: 2,
      })
    })

    it('gives up after three attempts', async () => {
      const failed = await seedRecipient()
      const stale = await seedRecipient()
      await seedDelivery(failed, { status: 'failed', attempts: 3 })
      await seedDelivery(stale, { status: 'sending', attempts: 3 })

      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(sendNotice).not.toHaveBeenCalled()
    })
  })

  describe('error codes', () => {
    it.each([
      'E_RATE_LIMIT_EXCEEDED',
      'E_DAILY_LIMIT_EXCEEDED',
    ])('stops the tick on %s and refunds the attempt', async (code) => {
      const first = await seedRecipient()
      const second = await seedRecipient()
      const third = await seedRecipient()

      sendNotice
        .mockResolvedValueOnce({ messageId: 'message-1' })
        .mockRejectedValueOnce(codedError(code))

      const result = await sweep()

      expect(result.stopReason).toBe('quota')
      expect(result.sentCount).toBe(1)
      expect(result.failedCount).toBe(1)
      expect(result.errorCodes).toEqual({ [code]: 1 })
      expect(sendNotice).toHaveBeenCalledTimes(2)
      expect(await readDelivery(first)).toMatchObject({ status: 'sent' })
      expect(await readDelivery(second)).toMatchObject({
        status: 'failed',
        attempts: 0,
        lastErrorCode: code,
      })
      expect(await readDelivery(third)).toBeUndefined()
    })

    it('does not retry a quota-failed row before its backoff', async () => {
      await seedRecipient()
      sendNotice.mockRejectedValueOnce(codedError('E_RATE_LIMIT_EXCEEDED'))

      await sweep()
      sendNotice.mockClear()
      const next = await sweep({ now: () => minutesBefore(-5) })

      expect(next.selectedCount).toBe(0)
      expect(sendNotice).not.toHaveBeenCalled()
    })

    it.each([
      'E_RECIPIENT_SUPPRESSED',
      'E_VALIDATION_ERROR',
      'E_VALIDATION_RECIPIENT',
    ])('marks %s skipped and carries on', async (code) => {
      const first = await seedRecipient()
      const second = await seedRecipient()

      sendNotice.mockRejectedValueOnce(codedError(code))

      const result = await sweep()

      expect(result).toMatchObject({
        skippedCount: 1,
        sentCount: 1,
        stopReason: 'completed',
      })
      expect(await readDelivery(first)).toMatchObject({
        status: 'skipped',
        attempts: 1,
        lastErrorCode: code,
      })
      expect(await readDelivery(second)).toMatchObject({ status: 'sent' })
    })

    it('marks other coded errors failed and carries on', async () => {
      const first = await seedRecipient()
      const second = await seedRecipient()

      sendNotice.mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))

      const result = await sweep()

      expect(result).toMatchObject({
        failedCount: 1,
        sentCount: 1,
        stopReason: 'completed',
      })
      expect(await readDelivery(first)).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastErrorCode: 'E_DELIVERY_FAILED',
      })
      expect(await readDelivery(second)).toMatchObject({ status: 'sent' })
    })

    it('records E_UNKNOWN for an error without a code', async () => {
      const userId = await seedRecipient()

      sendNotice.mockRejectedValueOnce(new Error('boom for someone@example.com'))

      const result = await sweep()

      expect(result.errorCodes).toEqual({ E_UNKNOWN: 1 })
      expect(await readDelivery(userId)).toMatchObject({
        status: 'failed',
        lastErrorCode: 'E_UNKNOWN',
      })
    })

    it('reads the code from the cause of a wrapped error', async () => {
      const userId = await seedRecipient()

      sendNotice.mockRejectedValueOnce(new Error('wrapped', {
        cause: codedError('E_RECIPIENT_SUPPRESSED'),
      }))

      await sweep()

      expect(await readDelivery(userId)).toMatchObject({
        status: 'skipped',
        lastErrorCode: 'E_RECIPIENT_SUPPRESSED',
      })
    })

    it('stops with an error when the delivery cannot be recorded', async () => {
      await seedRecipient()
      await seedRecipient()

      const logger = { set: vi.fn() }

      vi.spyOn(testDb.db, 'update').mockImplementation(() => {
        throw new Error('D1 is unavailable')
      })

      const result = await sweep({ logger })

      expect(result.stopReason).toBe('error')
      expect(sendNotice).toHaveBeenCalledTimes(1)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          legalNoticeSweepError: {
            phase: 'delivery-bookkeeping',
            noticeId: NOTICE.id,
            message: 'D1 is unavailable',
          },
        },
      })
    })
  })

  describe('circuit breaker', () => {
    it('stops after three failures in a row and refunds their attempts',
      async () => {
        const userIds = [
          await seedRecipient(),
          await seedRecipient(),
          await seedRecipient(),
          await seedRecipient(),
          await seedRecipient(),
        ]

        sendNotice
          .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
          .mockRejectedValueOnce(codedError('E_INTERNAL_SERVER_ERROR'))
          .mockRejectedValueOnce(new Error('no code'))

        const result = await sweep()

        expect(result.stopReason).toBe('consecutive-failures')
        expect(result.failedCount).toBe(3)
        expect(result.sentCount).toBe(0)
        expect(result.errorCodes).toEqual({
          E_DELIVERY_FAILED: 1,
          E_INTERNAL_SERVER_ERROR: 1,
          E_UNKNOWN: 1,
        })
        expect(sendNotice).toHaveBeenCalledTimes(3)
        expect(await readDelivery(userIds[0]!)).toMatchObject({
          status: 'failed',
          attempts: 0,
          lastErrorCode: 'E_DELIVERY_FAILED',
        })
        expect(await readDelivery(userIds[1]!)).toMatchObject({
          status: 'failed',
          attempts: 0,
          lastErrorCode: 'E_INTERNAL_SERVER_ERROR',
        })
        expect(await readDelivery(userIds[2]!)).toMatchObject({
          status: 'failed',
          attempts: 0,
          lastErrorCode: 'E_UNKNOWN',
        })
        expect(await readDelivery(userIds[3]!)).toBeUndefined()
        expect(await readDelivery(userIds[4]!)).toBeUndefined()
      })

    it('lets the refunded rows be tried again after the backoff', async () => {
      await seedRecipient()
      await seedRecipient()
      await seedRecipient()
      sendNotice.mockRejectedValue(codedError('E_DELIVERY_FAILED'))

      await sweep()
      sendNotice.mockReset()
      sendNotice.mockResolvedValue({ messageId: 'message' })

      const retry = await sweep({
        now: () => new Date(
          NOW.getTime() + LEGAL_NOTICE_FAILED_BACKOFF_MS + 60_000,
        ),
      })

      expect(retry.sentCount).toBe(3)
      expect((await readDeliveries()).map((row) => {
        return [row.status, row.attempts]
      })).toEqual([['sent', 1], ['sent', 1], ['sent', 1]])
    })

    it('does not count failures that are not in a row', async () => {
      for (let index = 0; index < 5; index++) {
        await seedRecipient()
      }

      sendNotice
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
        .mockResolvedValueOnce({ messageId: 'message-3' })
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))

      const result = await sweep()

      expect(result.stopReason).toBe('completed')
      expect(result.failedCount).toBe(4)
      expect((await readDeliveries()).map((row) => {
        return row.attempts
      })).toEqual([1, 1, 1, 1, 1])
    })

    it('does not count a skipped recipient as a failure', async () => {
      for (let index = 0; index < 5; index++) {
        await seedRecipient()
      }

      sendNotice
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))
        .mockRejectedValueOnce(codedError('E_RECIPIENT_SUPPRESSED'))
        .mockRejectedValueOnce(codedError('E_DELIVERY_FAILED'))

      const result = await sweep()

      expect(result.stopReason).toBe('completed')
      expect(result.skippedCount).toBe(1)
    })

    it.each([
      'E_EMAIL_NOT_CONFIGURED',
      'E_SENDER_NOT_VERIFIED',
      'E_SENDER_NOT_ALLOWED',
      'E_SENDER_DOMAIN_NOT_AVAILABLE',
      'E_RECIPIENT_NOT_ALLOWED',
    ])('stops at once on the systemic error %s and refunds the attempt',
      async (code) => {
        const first = await seedRecipient()
        const second = await seedRecipient()

        sendNotice.mockRejectedValueOnce(codedError(code))

        const result = await sweep()

        expect(result.stopReason).toBe('consecutive-failures')
        expect(result.failedCount).toBe(1)
        expect(sendNotice).toHaveBeenCalledTimes(1)
        expect(await readDelivery(first)).toMatchObject({
          status: 'failed',
          attempts: 0,
          lastErrorCode: code,
        })
        expect(await readDelivery(second)).toBeUndefined()
      })

    it('stops on a missing binding thrown without a code on the error itself',
      async () => {
        const userId = await seedRecipient()

        sendNotice.mockRejectedValueOnce(new Error('wrapped', {
          cause: codedError('E_EMAIL_NOT_CONFIGURED'),
        }))

        const result = await sweep()

        expect(result.stopReason).toBe('consecutive-failures')
        expect(await readDelivery(userId)).toMatchObject({
          attempts: 0,
          lastErrorCode: 'E_EMAIL_NOT_CONFIGURED',
        })
      })
  })

  describe('noop sends', () => {
    it('does not mark a noop send as sent and stops the tick', async () => {
      const first = await seedRecipient()
      const second = await seedRecipient()

      sendNotice.mockResolvedValue({ messageId: 'email-noop' })

      const result = await sweep()

      expect(result.stopReason).toBe('email-noop')
      expect(result.sentCount).toBe(0)
      expect(result.failedCount).toBe(1)
      expect(result.errorCodes).toEqual({ E_EMAIL_NOOP: 1 })
      expect(sendNotice).toHaveBeenCalledTimes(1)
      expect(await readDelivery(first)).toMatchObject({
        status: 'failed',
        attempts: 0,
        lastErrorCode: 'E_EMAIL_NOOP',
        messageId: null,
        sentAt: null,
      })
      expect(await readDelivery(second)).toBeUndefined()
    })
  })

  describe('deleted accounts', () => {
    it('skips a user deleted between selection and claim', async () => {
      const first = await seedRecipient()
      const second = await seedRecipient()
      const originalInsert = testDb.db.insert.bind(testDb.db)
      let insertCalls = 0

      vi.spyOn(testDb.db, 'insert').mockImplementation(((table: never) => {
        insertCalls += 1

        if (insertCalls === 1) {
          throw new Error('Failed query', {
            cause: new Error('D1_ERROR: FOREIGN KEY constraint failed: '
              + 'SQLITE_CONSTRAINT'),
          })
        }

        return originalInsert(table)
      }) as never)

      const result = await sweep()

      expect(result.stopReason).toBe('completed')
      expect(result.userDeletedCount).toBe(1)
      expect(result.sentCount).toBe(1)
      expect(await readDelivery(first)).toBeUndefined()
      expect(await readDelivery(second)).toMatchObject({ status: 'sent' })
    })

    it('still stops on a database error that is not a foreign key',
      async () => {
        await seedRecipient()

        vi.spyOn(testDb.db, 'insert').mockImplementation((() => {
          throw new Error('D1 is unavailable')
        }) as never)

        const result = await sweep()

        expect(result.stopReason).toBe('error')
        expect(result.userDeletedCount).toBe(0)
      })
  })

  describe('late deliveries', () => {
    const SHORT_NOTICE: LegalNotice = {
      ...NOTICE,
      id: '2026-11-test-short-notice',
      shortNoticeReason: 'The law requires this change.',
    }

    it('counts a notice sent less than 30 days before it takes effect',
      async () => {
        await seedRecipient()
        await seedRecipient()

        const result = await sweep({
          now: () => new Date('2026-11-10T10:00:00Z'),
        })

        expect(result.sentCount).toBe(2)
        expect(result.lateDeliveries).toBe(2)
        expect(result.notices[0]).toMatchObject({ lateDeliveries: 2 })
      })

    it('does not count a notice sent with 30 days or more left', async () => {
      await seedRecipient()

      const result = await sweep({
        now: () => new Date('2026-11-04T00:00:00Z'),
      })

      expect(result.sentCount).toBe(1)
      expect(result.lateDeliveries).toBe(0)
    })

    it('uses 14 days when the notice has a short-notice reason', async () => {
      await approveNotice(SHORT_NOTICE)
      await seedRecipient()
      await seedRecipient()

      const early = await sweep({
        notices: [SHORT_NOTICE],
        batchSize: 1,
        now: () => new Date('2026-11-18T10:00:00Z'),
      })
      const late = await sweep({
        notices: [SHORT_NOTICE],
        batchSize: 1,
        now: () => new Date('2026-11-25T10:00:00Z'),
      })

      expect(early.sentCount).toBe(1)
      expect(early.lateDeliveries).toBe(0)
      expect(late.sentCount).toBe(1)
      expect(late.lateDeliveries).toBe(1)
    })
  })

  describe('limits', () => {
    it('stops at the daily cap', async () => {
      await seedRecipient()
      await seedRecipient()
      await seedRecipient()

      const result = await sweep({ dailyCap: 2 })

      expect(result.sentCount).toBe(2)
      expect(result.stopReason).toBe('daily-cap')
    })

    it('counts what was already sent today towards the cap', async () => {
      const alreadySent = await seedRecipient()
      await seedRecipient()
      await seedRecipient()
      await seedDelivery(alreadySent, {
        status: 'sent',
        sentAt: minutesBefore(30),
      })

      const result = await sweep({ dailyCap: 2 })

      expect(result.sentCount).toBe(1)
      expect(result.stopReason).toBe('daily-cap')
    })

    it('does not count rows sent on an earlier UTC day', async () => {
      const sentYesterday = await seedRecipient()
      await seedRecipient()
      await seedDelivery(sentYesterday, {
        status: 'sent',
        sentAt: new Date('2026-11-01T23:59:00Z'),
      })

      const result = await sweep({ dailyCap: 1 })

      expect(result.sentCount).toBe(1)
    })

    it('sends nothing when the cap is already reached', async () => {
      const alreadySent = await seedRecipient()
      await seedRecipient()
      await seedDelivery(alreadySent, {
        status: 'sent',
        sentAt: minutesBefore(30),
      })

      const result = await sweep({ dailyCap: 1 })

      expect(result.stopReason).toBe('daily-cap')
      expect(sendNotice).not.toHaveBeenCalled()
    })

    it('stops when the maximum runtime is reached', async () => {
      await seedRecipient()
      await seedRecipient()
      await seedRecipient()

      let ticks = 0
      const result = await sweep({
        maxRuntimeMs: 25_000,
        now: () => new Date(NOW.getTime() + 10_000 * ticks++),
      })

      expect(result.stopReason).toBe('max-runtime')
      expect(result.sentCount).toBe(1)
      expect(await readDeliveries()).toHaveLength(1)
    })
  })
})
