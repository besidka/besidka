import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const FORGED_ID = '1ForgedForgedForgedForged01'

function filePart(storageKey: string, filename = storageKey) {
  return {
    type: 'file',
    mediaType: 'text/markdown',
    filename,
    url: `/files/${storageKey}`,
  }
}

describe('resolveDriveFileParts', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number

  async function seedCopy(owner: number, storageKey: string, id = FILE_ID) {
    await testDb.db.insert(schema.files).values({
      userId: owner,
      storageKey,
      name: 'Plan.md',
      size: 10,
      type: 'text/markdown',
      externalSource: 'google',
      externalId: id,
    })
  }

  async function resolve(parts: Array<{ type: string }>) {
    const { resolveDriveFileParts } = await import(
      '~~/server/utils/google/drive-parts'
    )

    return await resolveDriveFileParts({ userId, parts })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    otherUserId = await seedUser(testDb.db)
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('adds the canonical reference right after the copy it belongs to',
    async () => {
      await seedCopy(userId, 'copy.md')

      const parts = await resolve([
        { type: 'text', text: 'Summarize' } as never,
        filePart('copy.md') as never,
      ])

      expect(parts.map(part => part.type)).toEqual([
        'text',
        'file',
        'data-drive-file',
      ])
      expect(parts[2]).toEqual({
        type: 'data-drive-file',
        data: {
          driveFileId: FILE_ID,
          name: 'Plan.md',
          mimeType: 'text/markdown',
          link: `https://drive.google.com/open?id=${FILE_ID}`,
        },
      })
    })

  it('drops whatever reference the client sent and rebuilds it', async () => {
    await seedCopy(userId, 'copy.md')

    const parts = await resolve([
      { type: 'text', text: 'Summarize' } as never,
      filePart('copy.md') as never,
      {
        type: 'data-drive-file',
        data: {
          driveFileId: FORGED_ID,
          name: 'Forged',
          mimeType: 'x',
          link: 'https://evil.example/x',
        },
      } as never,
    ])
    const serialized = JSON.stringify(parts)

    expect(parts.filter(part => part.type === 'data-drive-file'))
      .toHaveLength(1)
    expect(serialized).not.toContain(FORGED_ID)
    expect(serialized).not.toContain('evil.example')
  })

  it('adds nothing for an ordinary upload and removes a forged reference',
    async () => {
      await testDb.db.insert(schema.files).values({
        userId,
        storageKey: 'plain.md',
        name: 'Plain.md',
        size: 10,
        type: 'text/markdown',
      })

      const parts = await resolve([
        { type: 'text', text: 'Hi' } as never,
        filePart('plain.md') as never,
        {
          type: 'data-drive-file',
          data: {
            driveFileId: FORGED_ID,
            name: 'Forged',
            mimeType: 'x',
            link: 'x',
          },
        } as never,
      ])

      expect(parts.map(part => part.type)).toEqual(['text', 'file'])
    })

  it('never reads another user\'s copy', async () => {
    await seedCopy(otherUserId, 'theirs.md')

    const parts = await resolve([
      { type: 'text', text: 'Hi' } as never,
      filePart('theirs.md') as never,
    ])

    expect(parts.map(part => part.type)).toEqual(['text', 'file'])
  })

  it('adds one reference for a copy attached twice', async () => {
    await seedCopy(userId, 'copy.md')

    const parts = await resolve([
      { type: 'text', text: 'Hi' } as never,
      filePart('copy.md') as never,
      filePart('copy.md') as never,
    ])

    expect(parts.filter(part => part.type === 'data-drive-file'))
      .toHaveLength(1)
  })

  it('costs no query for a message without file parts', async () => {
    const findMany = vi.spyOn(testDb.db.query.files, 'findMany')
    const parts = await resolve([{ type: 'text', text: 'Hi' } as never])

    expect(parts).toHaveLength(1)
    expect(findMany).not.toHaveBeenCalled()
  })
})
