import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  readDocument,
  seedDocument,
} from '../../../../setup/helpers/documents-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const {
  claimDocumentRender,
  markDocumentFailed,
  markDocumentReady,
  releaseDocumentClaim,
} = await import('~~/server/utils/documents/store')

const START = new Date('2026-11-11T10:00:00.000Z')

function secondsAfter(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000)
}

describe('document render claim', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  it('wins once for a spec_ready row and sets the lease', async () => {
    const document = await seedDocument(testDb.db, { userId })
    const claimed = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })

    expect(claimed).toMatchObject({
      id: document.id,
      status: 'rendering',
      renderAttempts: 1,
    })
    expect(claimed!.renderLeaseUntil!.getTime()).toBe(
      secondsAfter(120).getTime(),
    )
  })

  it('refuses a second claim while the lease is live', async () => {
    const document = await seedDocument(testDb.db, { userId })

    await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })

    const second = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: secondsAfter(10),
    })
    const stored = await readDocument(testDb.db, document.id)

    expect(second).toBeNull()
    expect(stored!.renderAttempts).toBe(1)
  })

  it('claims a failed row again and counts the attempt', async () => {
    const document = await seedDocument(testDb.db, {
      userId,
      status: 'failed',
      errorCode: 'render_failed',
      renderAttempts: 1,
    })
    const claimed = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })

    expect(claimed).toMatchObject({
      status: 'rendering',
      renderAttempts: 2,
    })
  })

  it('reclaims a stale lease after 120 seconds', async () => {
    const document = await seedDocument(testDb.db, { userId })

    await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })

    const reclaimed = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: secondsAfter(121),
    })

    expect(reclaimed).toMatchObject({
      status: 'rendering',
      renderAttempts: 2,
    })
    expect(reclaimed!.renderLeaseUntil!.getTime()).toBe(
      secondsAfter(241).getTime(),
    )
  })

  it('refuses a lease that has not expired yet', async () => {
    const document = await seedDocument(testDb.db, { userId })

    await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })

    const early = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: secondsAfter(119),
    })
    const atExpiry = await claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: secondsAfter(120),
    })

    expect(early).toBeNull()
    expect(atExpiry).toBeNull()
  })

  it('refuses a ready row', async () => {
    const document = await seedDocument(testDb.db, {
      userId,
      status: 'ready',
    })

    await expect(claimDocumentRender(testDb.db, {
      userId,
      documentId: document.id,
      now: START,
    })).resolves.toBeNull()
  })

  it('refuses another user and leaves the row untouched', async () => {
    const document = await seedDocument(testDb.db, { userId })
    const claimed = await claimDocumentRender(testDb.db, {
      userId: otherUserId,
      documentId: document.id,
      now: START,
    })
    const stored = await readDocument(testDb.db, document.id)

    expect(claimed).toBeNull()
    expect(stored).toMatchObject({ status: 'spec_ready', renderAttempts: 0 })
  })

  it('answers null for an id that is not a document id', async () => {
    await expect(claimDocumentRender(testDb.db, {
      userId,
      documentId: 'not a valid id',
      now: START,
    })).resolves.toBeNull()
  })

  describe('finishing a claim', () => {
    it('marks a claimed row ready with its file and renderer', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: START,
      })

      const ready = await markDocumentReady(testDb.db, {
        documentId: document.id,
        fileId: 'pub-7',
        renderedBy: 'client',
      })

      expect(ready).toMatchObject({
        status: 'ready',
        fileId: 'pub-7',
        renderedBy: 'client',
        errorCode: null,
        renderLeaseUntil: null,
      })
    })

    it('does not mark a row ready without a claim', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await expect(markDocumentReady(testDb.db, {
        documentId: document.id,
        fileId: 'pub-7',
        renderedBy: 'worker',
      })).resolves.toBeNull()
    })

    it('does not let a late finisher overwrite a ready row', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: START,
      })
      await markDocumentReady(testDb.db, {
        documentId: document.id,
        fileId: 'pub-7',
        renderedBy: 'client',
      })

      await expect(markDocumentReady(testDb.db, {
        documentId: document.id,
        fileId: 'pub-8',
        renderedBy: 'worker',
      })).resolves.toBeNull()
      await expect(markDocumentFailed(testDb.db, {
        documentId: document.id,
        errorCode: 'render_failed',
      })).resolves.toBeNull()

      const stored = await readDocument(testDb.db, document.id)

      expect(stored).toMatchObject({ status: 'ready', fileId: 'pub-7' })
    })

    it('marks a claimed row failed and clears the lease', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: START,
      })

      const failed = await markDocumentFailed(testDb.db, {
        documentId: document.id,
        errorCode: 'validation_failed',
      })

      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'validation_failed',
        renderLeaseUntil: null,
      })
    })

    it('releases a claim without recording a failure', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: START,
      })

      const released = await releaseDocumentClaim(testDb.db, {
        documentId: document.id,
      })

      expect(released).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
        errorCode: null,
        renderAttempts: 1,
      })
    })
  })
})
