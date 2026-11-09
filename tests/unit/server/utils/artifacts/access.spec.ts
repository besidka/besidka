import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { createArtifact, decodeArtifactId, encodeArtifactId } = await import(
  '~~/server/utils/artifacts/store'
)
const { resolveArtifactViewerAccess } = await import(
  '~~/server/utils/artifacts/access'
)

describe('resolveArtifactViewerAccess', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let ownerId: number
  let strangerId: number
  let artifactId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)

    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId: ownerId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
  })

  afterEach(() => {
    testDb.close()
  })

  function resolve(overrides: {
    viewerUserId?: number
    artifactId?: string
    shareToken?: string | null
  } = {}) {
    return resolveArtifactViewerAccess({
      db: testDb.db,
      viewerUserId: ownerId,
      artifactId,
      ...overrides,
    })
  }

  it('grants the owner storage and bridge access', async () => {
    await expect(resolve()).resolves.toEqual({
      mode: 'owner',
      artifactId,
      artifactInternalId: decodeArtifactId(artifactId),
      ownerUserId: ownerId,
      viewerUserId: ownerId,
      storageAllowed: true,
      bridgeAllowed: true,
    })
  })

  it('answers 404 for a signed-in viewer who is not the owner', async () => {
    await expect(resolve({ viewerUserId: strangerId }))
      .rejects.toMatchObject({ status: 404, code: 'artifact_not_found' })
  })

  it('answers 404 for a non-owner even with a share token', async () => {
    await expect(resolve({
      viewerUserId: strangerId,
      shareToken: 'share-token',
    })).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 for an id that cannot be decoded', async () => {
    await expect(resolve({ artifactId: 'not-an-artifact-id!' }))
      .rejects.toMatchObject({ status: 404, code: 'artifact_not_found' })
    await expect(resolve({ artifactId: '' }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 for a well-formed id that does not exist', async () => {
    const forgedId = encodeArtifactId(
      (decodeArtifactId(artifactId) as number) + 1000,
    )

    await expect(resolve({ artifactId: forgedId }))
      .rejects.toMatchObject({ status: 404, code: 'artifact_not_found' })
  })

  it('answers 404 once the artifact is deleted', async () => {
    testDb.sqlite.prepare('delete from artifacts where id = ?')
      .run(decodeArtifactId(artifactId))

    await expect(resolve()).rejects.toMatchObject({ status: 404 })
  })

  it('answers 451 for a taken-down artifact', async () => {
    testDb.sqlite.prepare(
      'update artifacts set takedown_at = 1 where id = ?',
    ).run(decodeArtifactId(artifactId))

    await expect(resolve()).rejects.toMatchObject({
      status: 451,
      code: 'artifact_taken_down',
    })
  })

  it('answers 404 to a non-owner before revealing a takedown', async () => {
    testDb.sqlite.prepare(
      'update artifacts set takedown_at = 1 where id = ?',
    ).run(decodeArtifactId(artifactId))

    await expect(resolve({ viewerUserId: strangerId }))
      .rejects.toMatchObject({ status: 404 })
  })
})
