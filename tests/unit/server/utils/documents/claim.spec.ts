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
  toDocumentClaim,
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

  async function claimAt(documentId: string, now: Date) {
    const claimed = await claimDocumentRender(testDb.db, {
      userId,
      documentId,
      now,
    })

    return toDocumentClaim(claimed!)
  }

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
      const claim = await claimAt(document.id, START)
      const ready = await markDocumentReady(testDb.db, {
        documentId: document.id,
        claim,
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
        claim: { renderLeaseUntil: secondsAfter(120), renderAttempts: 1 },
        fileId: 'pub-7',
        renderedBy: 'worker',
      })).resolves.toBeNull()
    })

    it('does not let a late finisher overwrite a ready row', async () => {
      const document = await seedDocument(testDb.db, { userId })
      const claim = await claimAt(document.id, START)

      await markDocumentReady(testDb.db, {
        documentId: document.id,
        claim,
        fileId: 'pub-7',
        renderedBy: 'client',
      })

      await expect(markDocumentReady(testDb.db, {
        documentId: document.id,
        claim,
        fileId: 'pub-8',
        renderedBy: 'worker',
      })).resolves.toBeNull()
      await expect(markDocumentFailed(testDb.db, {
        documentId: document.id,
        claim,
        errorCode: 'render_failed',
      })).resolves.toBeNull()

      const stored = await readDocument(testDb.db, document.id)

      expect(stored).toMatchObject({ status: 'ready', fileId: 'pub-7' })
    })

    it('marks a claimed row failed and clears the lease', async () => {
      const document = await seedDocument(testDb.db, { userId })
      const claim = await claimAt(document.id, START)
      const failed = await markDocumentFailed(testDb.db, {
        documentId: document.id,
        claim,
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
      const claim = await claimAt(document.id, START)
      const released = await releaseDocumentClaim(testDb.db, {
        documentId: document.id,
        claim,
      })

      expect(released).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
        errorCode: null,
        renderAttempts: 1,
      })
    })

    it('refuses a claim handle without a lease', () => {
      expect(() => toDocumentClaim({
        renderLeaseUntil: null,
        renderAttempts: 0,
      })).toThrow('The document claim has no lease')
    })
  })

  describe('a claim that was taken over', () => {
    async function seedTakeover() {
      const document = await seedDocument(testDb.db, { userId })
      const claimOfA = toDocumentClaim((await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: START,
      }))!)
      const claimOfB = toDocumentClaim((await claimDocumentRender(testDb.db, {
        userId,
        documentId: document.id,
        now: secondsAfter(121),
      }))!)

      return { document, claimOfA, claimOfB }
    }

    it('gives the two claims different identities', async () => {
      const { claimOfA, claimOfB } = await seedTakeover()

      expect(claimOfB.renderAttempts).toBe(claimOfA.renderAttempts + 1)
      expect(claimOfB.renderLeaseUntil.getTime()).toBeGreaterThan(
        claimOfA.renderLeaseUntil.getTime(),
      )
    })

    it('does not let A fail the row B is rendering', async () => {
      const { document, claimOfA } = await seedTakeover()

      await expect(markDocumentFailed(testDb.db, {
        documentId: document.id,
        claim: claimOfA,
        errorCode: 'render_failed',
      })).resolves.toBeNull()

      expect(await readDocument(testDb.db, document.id)).toMatchObject({
        status: 'rendering',
        errorCode: null,
        renderAttempts: 2,
      })
    })

    it('does not let A release the row B is rendering', async () => {
      const { document, claimOfA, claimOfB } = await seedTakeover()

      await expect(releaseDocumentClaim(testDb.db, {
        documentId: document.id,
        claim: claimOfA,
      })).resolves.toBeNull()

      const stored = await readDocument(testDb.db, document.id)

      expect(stored).toMatchObject({ status: 'rendering', renderAttempts: 2 })
      expect(stored!.renderLeaseUntil!.getTime()).toBe(
        claimOfB.renderLeaseUntil.getTime(),
      )
    })

    it('does not let A mark the row ready with its own file', async () => {
      const { document, claimOfA } = await seedTakeover()

      await expect(markDocumentReady(testDb.db, {
        documentId: document.id,
        claim: claimOfA,
        fileId: 'pub-1',
        renderedBy: 'client',
      })).resolves.toBeNull()

      expect(await readDocument(testDb.db, document.id)).toMatchObject({
        status: 'rendering',
        fileId: null,
      })
    })

    it('still lets B finish after A tried everything', async () => {
      const { document, claimOfA, claimOfB } = await seedTakeover()

      await markDocumentFailed(testDb.db, {
        documentId: document.id,
        claim: claimOfA,
        errorCode: 'render_failed',
      })
      await releaseDocumentClaim(testDb.db, {
        documentId: document.id,
        claim: claimOfA,
      })

      const ready = await markDocumentReady(testDb.db, {
        documentId: document.id,
        claim: claimOfB,
        fileId: 'pub-2',
        renderedBy: 'worker',
      })

      expect(ready).toMatchObject({
        status: 'ready',
        fileId: 'pub-2',
        renderedBy: 'worker',
      })
    })

    it('does not let a released claim finish later', async () => {
      const document = await seedDocument(testDb.db, { userId })
      const claim = await claimAt(document.id, START)

      await releaseDocumentClaim(testDb.db, { documentId: document.id, claim })

      await expect(markDocumentReady(testDb.db, {
        documentId: document.id,
        claim,
        fileId: 'pub-3',
        renderedBy: 'client',
      })).resolves.toBeNull()
    })
  })
})
