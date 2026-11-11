import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const guards = vi.hoisted(() => ({
  isFeatureOn: true,
  requireFeature: vi.fn(),
}))

vi.mock('~~/server/utils/features/guards', () => ({
  FEATURE_UNAVAILABLE_WHY: 'feature_unavailable',
  requireFeature: guards.requireFeature,
}))

const { resolveArtifactAttachmentParts } = await import(
  '~~/server/utils/artifacts/attachments'
)
const { createArtifact, decodeArtifactId } = await import(
  '~~/server/utils/artifacts/store'
)

describe('resolveArtifactAttachmentParts', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  const storage = createMemoryBlobStore()
  const logger = { set: vi.fn() }
  const event = { context: {} }
  const text = { type: 'text', text: 'Use this' }

  function attachment(
    artifactId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      type: 'data-artifact-attachment',
      data: {
        artifactId,
        version: 1,
        kind: 'svg',
        title: 'Forged title',
        ...overrides,
      },
    }
  }

  async function seed(title: string, owner = userId) {
    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId: owner,
      kind: 'markdown',
      title,
      content: 'body',
      createdVia: 'chat',
      createdBy: 'model',
    })

    return created.artifactId
  }

  function resolve(
    parts: Array<{ type: string }>,
    onUnavailable?: 'throw' | 'drop',
  ) {
    return resolveArtifactAttachmentParts({
      event: event as never,
      db: testDb.db,
      userId,
      parts,
      logger,
      onUnavailable,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    guards.isFeatureOn = true
    guards.requireFeature.mockReset()
    guards.requireFeature.mockImplementation(async () => {
      if (!guards.isFeatureOn) {
        throw Object.assign(new Error('Not found'), {
          status: 404,
          why: 'feature_unavailable',
        })
      }
    })
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns a message without attachments untouched and checks nothing',
    async () => {
      const parts = [text]

      await expect(resolve(parts)).resolves.toEqual(parts)
      expect(guards.requireFeature).not.toHaveBeenCalled()
    })

  it('rewrites kind and title from the stored artifact', async () => {
    const id = await seed('Real title')
    const result = await resolve([text, attachment(id)])

    expect(guards.requireFeature).toHaveBeenCalledWith(event, 'artifacts')
    expect(result).toEqual([
      text,
      {
        type: 'data-artifact-attachment',
        data: {
          artifactId: id,
          version: 1,
          kind: 'markdown',
          title: 'Real title',
        },
      },
    ])
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { artifacts: { attachedArtifacts: 1 } },
    })
  })

  it('answers 404 feature_unavailable without access', async () => {
    const id = await seed('Mine')

    guards.isFeatureOn = false

    await expect(resolve([text, attachment(id)])).rejects.toMatchObject({
      status: 404,
      why: 'feature_unavailable',
    })
  })

  it('rejects another user\'s artifact like a missing one', async () => {
    const otherUserId = await seedUser(testDb.db, null)
    const foreign = await seed('Foreign', otherUserId)

    await expect(resolve([text, attachment(foreign)])).rejects.toMatchObject({
      status: 400,
      code: 'artifact_attachment_unavailable',
    })
    await expect(resolve([text, attachment('garbage')])).rejects.toMatchObject({
      status: 400,
      code: 'artifact_attachment_unavailable',
    })
  })

  it('rejects a version that does not exist', async () => {
    const id = await seed('Mine')

    await expect(
      resolve([text, attachment(id, { version: 2 })]),
    ).rejects.toMatchObject({
      status: 400,
      code: 'artifact_attachment_unavailable',
    })
  })

  it('rejects a taken-down artifact with 451', async () => {
    const id = await seed('Removed')

    testDb.sqlite.prepare(
      'update artifacts set takedown_at = 1 where id = ?',
    ).run(decodeArtifactId(id))

    await expect(resolve([text, attachment(id)])).rejects.toMatchObject({
      status: 451,
    })
  })

  it('drops what no longer resolves when the message is already stored',
    async () => {
      const good = await seed('Good')
      const removed = await seed('Removed')

      testDb.sqlite.prepare(
        'update artifacts set takedown_at = 1 where id = ?',
      ).run(decodeArtifactId(removed))

      const result = await resolve([
        text,
        attachment(good),
        attachment(removed),
        attachment('garbage'),
      ], 'drop')

      expect(result.map(part => part.type)).toEqual([
        'text',
        'data-artifact-attachment',
      ])
    })

  it('drops every attachment of a stored message once access is gone',
    async () => {
      const id = await seed('Mine')

      guards.isFeatureOn = false

      await expect(
        resolve([text, attachment(id)], 'drop'),
      ).resolves.toEqual([text])
    })

  it('still throws other errors in drop mode', async () => {
    const id = await seed('Mine')

    guards.requireFeature.mockRejectedValueOnce(new Error('boom'))

    await expect(
      resolve([text, attachment(id)], 'drop'),
    ).rejects.toThrow('boom')
  })
})
