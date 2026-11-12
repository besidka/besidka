import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../setup/helpers/artifacts-store'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  storage: null as unknown as MemoryBlobStore,
  sessionUserId: 0,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useEncryptText: async (plain: string) => `enc:${plain}`,
  useDecryptText: async (encrypted: string) => encrypted.slice(4),
}))

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: mocks.requireFeature,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const { createArtifact } = await import('~~/server/utils/artifacts/store')
const { createArtifactShare, revokeArtifactShares } = await import(
  '~~/server/utils/artifacts/shares'
)

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

function createEvent(query: Record<string, string> = {}) {
  return {
    context: {},
    params: {},
    query,
    res: { headers: new Headers() },
  }
}

describe('shared artifacts owner API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let strangerId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    mocks.storage = createMemoryBlobStore()
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    mocks.sessionUserId = ownerId
    mocks.featureActive = true
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedArtifact(userId: number, title: string, kind = 'html') {
    return await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId,
      kind: kind as 'html',
      title,
      content: '<p>v1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })
  }

  async function seedShare(
    userId: number,
    artifactId: string,
    expiresAt: Date | null = null,
  ) {
    return await createArtifactShare({
      db: testDb.db,
      userId,
      artifactId,
      expiresAt,
      pinnedVersion: null,
      storageAllowed: false,
      bridgeAllowed: false,
      createdVia: 'ui',
      baseUrl: 'https://besidka.test',
    })
  }

  it('lists only artifacts with an active link, one row each', async () => {
    const list = await importHandler(
      '../../../server/api/v1/artifacts/shared/index.get',
    )
    const shared = await seedArtifact(ownerId, 'Shared quiz')
    const revoked = await seedArtifact(ownerId, 'Revoked quiz')
    const expired = await seedArtifact(ownerId, 'Expired quiz')
    const unshared = await seedArtifact(ownerId, 'Private quiz')

    await seedShare(ownerId, shared.artifactId)
    await seedShare(ownerId, shared.artifactId)

    const revokedShare = await seedShare(ownerId, revoked.artifactId)

    await revokeArtifactShares({
      db: testDb.db,
      userId: ownerId,
      shareIds: [revokedShare.share.shareId],
    })
    await seedShare(
      ownerId,
      expired.artifactId,
      new Date(Date.now() - DAY_MILLISECONDS),
    )

    const response = await list(createEvent())

    expect(unshared.artifactId).toBeTruthy()
    expect(response.total).toBe(1)
    expect(response.items).toEqual([
      {
        id: shared.artifactId,
        title: 'Shared quiz',
        kind: 'html',
        currentVersion: 1,
        updatedAt: expect.any(String),
        activeShareCount: 2,
        nearestExpiresAt: null,
        hasPermanentLink: true,
      },
    ])
  })

  it('reports the nearest expiry across the active links', async () => {
    const list = await importHandler(
      '../../../server/api/v1/artifacts/shared/index.get',
    )
    const artifact = await seedArtifact(ownerId, 'Timed quiz')
    const nearest = new Date(Date.now() + 2 * DAY_MILLISECONDS)
    const later = new Date(Date.now() + 9 * DAY_MILLISECONDS)

    await seedShare(ownerId, artifact.artifactId, later)
    await seedShare(ownerId, artifact.artifactId, nearest)

    const response = await list(createEvent())
    const [item] = response.items

    expect(item.activeShareCount).toBe(2)
    expect(item.hasPermanentLink).toBe(false)
    expect(new Date(item.nearestExpiresAt).getTime())
      .toBe(Math.floor(nearest.getTime() / 1000) * 1000)
  })

  it('never lists another user artifact or link', async () => {
    const list = await importHandler(
      '../../../server/api/v1/artifacts/shared/index.get',
    )
    const own = await seedArtifact(ownerId, 'My quiz')
    const foreign = await seedArtifact(strangerId, 'Stranger quiz')

    await seedShare(ownerId, own.artifactId)
    await seedShare(strangerId, foreign.artifactId)

    const response = await list(createEvent())

    expect(response.total).toBe(1)
    expect(response.items.map((item: { id: string }) => item.id))
      .toEqual([own.artifactId])
  })

  it('pages the list and counts every shared artifact', async () => {
    const list = await importHandler(
      '../../../server/api/v1/artifacts/shared/index.get',
    )

    for (const title of ['One', 'Two', 'Three']) {
      const artifact = await seedArtifact(ownerId, title)

      await seedShare(ownerId, artifact.artifactId)
    }

    const first = await list(createEvent({ limit: '2' }))
    const second = await list(createEvent({ limit: '2', offset: '2' }))

    expect(first.total).toBe(3)
    expect(first.items).toHaveLength(2)
    expect(second.items).toHaveLength(1)
  })

  it('rejects an invalid query', async () => {
    const list = await importHandler(
      '../../../server/api/v1/artifacts/shared/index.get',
    )

    await expect(list(createEvent({ limit: '0' })))
      .rejects.toMatchObject({ status: 400 })
  })

  it('answers 404 when sharing is off and 401 without a session',
    async () => {
      const list = await importHandler(
        '../../../server/api/v1/artifacts/shared/index.get',
      )

      mocks.featureActive = false

      await expect(list(createEvent())).rejects.toMatchObject({ status: 404 })
      expect(mocks.requireFeature)
        .toHaveBeenCalledWith(expect.anything(), 'artifacts.share')

      mocks.featureActive = true
      mocks.sessionUserId = 0

      await expect(list(createEvent())).rejects.toMatchObject({ status: 401 })
    })
})
