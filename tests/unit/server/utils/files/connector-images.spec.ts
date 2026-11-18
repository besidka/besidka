import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  CONNECTOR_IMAGE_PART_TYPE,
} from '#shared/utils/connector-image-parts'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedMessage,
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
  deleteAllConnectorImages,
  deleteConnectorImageFiles,
  findChatConnectorImageFilesByIds,
  findChatsConnectorImageFiles,
  findMissingConnectorImageFileIds,
  markDeletedConnectorImages,
} = await import('~~/server/utils/files/connector-images')
const { linkConnectorImagesToMessage } = await import(
  '~~/server/utils/connectors/image-saver'
)
const { getFilesSourceCondition, filesSourceFilters } = await import(
  '~~/server/utils/files/source-filter'
)

function imagePart(fileId: string, storageKey: string, toolCallId = 'call-1') {
  return {
    type: CONNECTOR_IMAGE_PART_TYPE,
    id: `connector-image-${toolCallId}-0`,
    data: {
      toolCallId,
      fileId,
      url: `/files/${storageKey}`,
      mediaType: 'image/png',
      width: 1,
      height: 1,
      size: 75,
      name: 'doop-get_frame_screenshot.png',
    },
  }
}

describe('connector image files', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let storageDelete: ReturnType<typeof vi.fn>
  const logger = { set: vi.fn() }

  async function insertFile(
    owner: number,
    storageKey: string,
    source: 'upload' | 'assistant' | 'connector' = 'connector',
    chatPublicId?: string,
  ): Promise<string> {
    const [row] = await testDb.db.insert(schema.files).values({
      userId: owner,
      storageKey,
      name: storageKey,
      size: 75,
      type: 'image/png',
      source,
      originProvider: chatPublicId ? `chat:${chatPublicId}` : null,
    }).returning({ id: schema.files.id })

    return row!.id
  }

  async function fileExists(fileId: string): Promise<boolean> {
    const row = await testDb.db.select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.id, fileId))
      .get()

    return !!row
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    storageDelete = vi.fn(async () => undefined)
    logger.set.mockClear()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useKV', () => ({
      delete: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('finds every connector image of a chat by its marker, even one no '
    + 'stored message shows', async () => {
    const chat = await seedChat(testDb.db, userId)
    const otherChat = await seedChat(testDb.db, userId)
    const shown = await insertFile(userId, 'connector-own.png', 'connector', chat.id)
    const unlinked = await insertFile(
      userId,
      'connector-unlinked.png',
      'connector',
      chat.id,
    )

    await insertFile(userId, 'connector-other.png', 'connector', otherChat.id)
    await insertFile(otherUserId, 'connector-x.png', 'connector', chat.id)
    await insertFile(userId, 'generated.png', 'assistant', chat.id)
    await seedMessage(testDb.db, chat.id, 'assistant', [
      imagePart(shown, 'connector-own.png'),
    ], minutesBefore(10))

    const files = await findChatsConnectorImageFiles(
      testDb.db,
      [chat.id],
      userId,
    )

    expect(files.map(file => file.id).sort()).toEqual([shown, unlinked].sort())
  })

  it('finds the given ids only among this user\'s connector files of the '
    + 'chat', async () => {
    const chat = await seedChat(testDb.db, userId)
    const otherChat = await seedChat(testDb.db, userId)
    const own = await insertFile(userId, 'connector-own.png', 'connector', chat.id)
    const otherChatFile = await insertFile(
      userId,
      'connector-other-chat.png',
      'connector',
      otherChat.id,
    )
    const otherUserFile = await insertFile(
      otherUserId,
      'connector-other-user.png',
      'connector',
      chat.id,
    )
    const generated = await insertFile(
      userId,
      'generated.png',
      'assistant',
      chat.id,
    )

    const files = await findChatConnectorImageFilesByIds(testDb.db, {
      userId,
      chatPublicId: chat.id,
      fileIds: [own, otherChatFile, otherUserFile, generated, 'missing'],
    })

    expect(files).toEqual([
      { id: own, storageKey: 'connector-own.png', size: 75 },
    ])
  })

  it('reports and marks the images whose file is gone in one pass',
    async () => {
      const kept = await insertFile(userId, 'connector-kept.png')
      const parts = [
        imagePart(kept, 'connector-kept.png'),
        imagePart('gone-id', 'connector-gone.png', 'call-2'),
        { type: 'text', text: 'Done' },
      ]

      expect(await findMissingConnectorImageFileIds(testDb.db, userId, parts))
        .toEqual(['gone-id'])

      const [message] = await markDeletedConnectorImages(testDb.db, userId, [
        { parts: parts as never },
      ])
      const missingPart = parts[1] as ReturnType<typeof imagePart>

      expect(message!.parts).toEqual([
        parts[0],
        { ...missingPart, data: { ...missingPart.data, deleted: true } },
        parts[2],
      ])
    })

  it('deletes every connector image of the user and nothing else',
    async () => {
      const first = await insertFile(userId, 'connector-1.png')
      const second = await insertFile(userId, 'connector-2.png')
      const generated = await insertFile(userId, 'generated.png', 'assistant')
      const others = await insertFile(otherUserId, 'connector-3.png')

      expect(await deleteAllConnectorImages(testDb.db, userId, logger))
        .toEqual({ deleted: 2, failed: 0, hasMore: false })
      expect(storageDelete).toHaveBeenCalledWith(
        expect.arrayContaining(['connector-1.png', 'connector-2.png']),
      )
      expect(await fileExists(first)).toBe(false)
      expect(await fileExists(second)).toBe(false)
      expect(await fileExists(generated)).toBe(true)
      expect(await fileExists(others)).toBe(true)
    })

  it('deletes the rows before the objects and logs objects R2 kept',
    async () => {
      const image = await insertFile(userId, 'connector-1.png')

      storageDelete.mockRejectedValue(new Error('R2 down'))

      expect(await deleteConnectorImageFiles(testDb.db, userId, [
        { id: image, storageKey: 'connector-1.png' },
      ], logger)).toEqual({ deleted: 1, failed: 0 })
      expect(await fileExists(image)).toBe(false)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          connectorImagesDelete: {
            orphanedObjects: 1,
            objectError: 'R2 down',
          },
        },
      })
    })

  it('keeps the objects when the row delete fails', async () => {
    const failingDb = {
      delete: () => ({
        where: async () => {
          throw new Error('D1 down')
        },
      }),
    }

    expect(await deleteConnectorImageFiles(failingDb as never, userId, [
      { id: 'file-1', storageKey: 'connector-1.png' },
    ], logger)).toEqual({ deleted: 0, failed: 1 })
    expect(storageDelete).not.toHaveBeenCalled()
  })

  it('deletes at most three batches of 90 per call', async () => {
    const insert = testDb.sqlite.prepare(`
      insert into files (user_id, storage_key, name, size, type, source,
        created_at, updated_at)
      values (?, ?, ?, 75, 'image/png', 'connector', 1, 1)
    `)

    for (let index = 0; index < 300; index++) {
      insert.run(userId, `connector-${index}.png`, `image-${index}.png`)
    }

    expect(await deleteAllConnectorImages(testDb.db, userId, logger))
      .toEqual({ deleted: 270, failed: 0, hasMore: true })
    expect(storageDelete).toHaveBeenCalledTimes(3)
    expect(await deleteAllConnectorImages(testDb.db, userId, logger))
      .toEqual({ deleted: 30, failed: 0, hasMore: false })
  })

  it('links only connector images that have no origin yet', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [], minutesBefore(5), {
      publicId: 'msg-new',
    })
    await seedMessage(testDb.db, chat.id, 'assistant', [], minutesBefore(9), {
      publicId: 'msg-old',
    })

    const messageRows = testDb.sqlite
      .prepare('select id, public_id as publicId from messages')
      .all() as Array<{ id: number, publicId: string }>
    const oldRowId = messageRows.find(row => row.publicId === 'msg-old')!.id
    const newRowId = messageRows.find(row => row.publicId === 'msg-new')!.id
    const fresh = await insertFile(userId, 'connector-fresh.png')
    const reused = await insertFile(userId, 'connector-reused.png')
    const generated = await insertFile(userId, 'generated.png', 'assistant')

    await testDb.db.update(schema.files)
      .set({ originMessageId: oldRowId })
      .where(eq(schema.files.id, reused))

    await linkConnectorImagesToMessage(testDb.db, {
      userId,
      messagePublicId: 'msg-new',
      fileIds: [fresh, reused, generated],
    }, logger)

    const origins = testDb.sqlite
      .prepare('select storage_key as storageKey, origin_message_id as origin '
        + 'from files order by storage_key')
      .all()

    expect(origins).toEqual([
      { storageKey: 'connector-fresh.png', origin: newRowId },
      { storageKey: 'connector-reused.png', origin: oldRowId },
      { storageKey: 'generated.png', origin: null },
    ])
  })

  it('hides connector images from every file list source', async () => {
    await insertFile(userId, 'connector-1.png')
    await insertFile(userId, 'upload.png', 'upload')
    await insertFile(userId, 'generated.png', 'assistant')

    for (const source of filesSourceFilters) {
      const rows = await testDb.db.select({ source: schema.files.source })
        .from(schema.files)
        .where(and(
          eq(schema.files.userId, userId),
          getFilesSourceCondition(source),
        ))

      expect(rows.map(row => row.source), source).not.toContain('connector')
    }
  })
})
