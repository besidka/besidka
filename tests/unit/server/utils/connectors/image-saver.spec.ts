import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import { createStorageFullError } from '~~/server/utils/storage/errors'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  RED_PNG_BASE64,
  RED_PNG_BYTES,
  gifBytes,
  toBase64,
} from '../../../../setup/helpers/connector-images'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  buildConnectorImageFileName,
  buildConnectorImageStorageKey,
  createConnectorImageSaver,
} = await import('~~/server/utils/connectors/image-saver')

const CHAT_ID = 'chat-public-1'
const RED_PNG = { mediaType: 'image/png' as const, data: RED_PNG_BASE64, bytes: RED_PNG_BYTES }
const GIF_BYTES = gifBytes(3, 2)
const GIF = {
  mediaType: 'image/gif' as const,
  data: toBase64(GIF_BYTES),
  bytes: GIF_BYTES.length,
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Buffer.from(digest).toString('hex')
}

describe('connector image saver', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let fileSequence: number
  const logger = { set: vi.fn() }
  const persist = vi.fn()
  const storage = {
    head: vi.fn(),
    put: vi.fn(),
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    fileSequence = 0
    logger.set.mockClear()
    persist.mockReset()
    storage.head.mockReset().mockResolvedValue({ key: 'present' })
    storage.put.mockReset().mockResolvedValue({ key: 'restored' })
    persist.mockImplementation(async (input: {
      storageKey: string
      fileName: string
      fileData: Uint8Array
    }) => {
      fileSequence += 1

      return {
        id: `file-${fileSequence}`,
        storageKey: input.storageKey,
        name: input.fileName,
        size: input.fileData.byteLength,
        type: 'image/png',
        source: 'connector',
        expiresAt: null,
      }
    })
  })

  afterEach(() => {
    testDb.close()
  })

  function createSaver() {
    return createConnectorImageSaver({
      db: testDb.db,
      userId,
      chatPublicId: CHAT_ID,
      logger,
      persist,
      storage: storage as never,
    })
  }

  it('saves each image as an unmarked connector file and keeps its part',
    async () => {
      const saver = createSaver()

      expect(await saver.save({
        toolCallId: 'call-1',
        connectorSlug: 'doop',
        toolName: 'get_frame_screenshot',
        images: [RED_PNG, GIF],
      })).toEqual(['saved', 'saved'])

      const firstCall = persist.mock.calls[0]![0]

      expect(firstCall).toMatchObject({
        userId,
        fileName: 'doop-get_frame_screenshot.png',
        mediaType: 'image/png',
        source: 'connector',
        originProvider: `chat:${CHAT_ID}`,
        logger,
      })
      expect(Buffer.from(firstCall.fileData).toString('base64'))
        .toBe(RED_PNG_BASE64)
      expect(firstCall.storageKey).toMatch(/^connector-[0-9a-f]{64}\.png$/)
      expect(persist.mock.calls[1]![0].fileName)
        .toBe('doop-get_frame_screenshot-2.gif')
      expect(saver.partsFor('call-1')).toEqual([
        {
          toolCallId: 'call-1',
          fileId: 'file-1',
          url: `/files/${firstCall.storageKey}`,
          mediaType: 'image/png',
          width: 8,
          height: 8,
          size: RED_PNG_BYTES,
          name: 'doop-get_frame_screenshot.png',
        },
        expect.objectContaining({
          fileId: 'file-2',
          mediaType: 'image/gif',
          width: 3,
          height: 2,
        }),
      ])
    })

  it('reuses the file of a frame already saved in this send', async () => {
    const saver = createSaver()

    await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })
    await saver.save({
      toolCallId: 'call-2',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })

    expect(persist).toHaveBeenCalledTimes(1)
    expect(saver.partsFor('call-2')[0]!.fileId).toBe('file-1')
  })

  it('reuses the file an earlier send of the chat saved', async () => {
    const storageKey = await buildConnectorImageStorageKey({
      userId,
      chatPublicId: CHAT_ID,
      contentHash: await sha256Hex(Buffer.from(RED_PNG_BASE64, 'base64')),
      mediaType: 'image/png',
    })
    const [row] = await testDb.db.insert(schema.files).values({
      userId,
      storageKey,
      name: 'renamed.png',
      size: RED_PNG_BYTES,
      type: 'image/png',
      source: 'connector',
    }).returning({ id: schema.files.id })
    const saver = createSaver()

    expect(await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })).toEqual(['saved'])
    expect(persist).not.toHaveBeenCalled()
    expect(storage.head).toHaveBeenCalledWith(storageKey)
    expect(storage.put).not.toHaveBeenCalled()
    expect(saver.partsFor('call-1')[0]).toMatchObject({
      fileId: row!.id,
      url: `/files/${storageKey}`,
      name: 'renamed.png',
    })
  })

  it('puts the bytes back when a reused row lost its object', async () => {
    const storageKey = await buildConnectorImageStorageKey({
      userId,
      chatPublicId: CHAT_ID,
      contentHash: await sha256Hex(Buffer.from(RED_PNG_BASE64, 'base64')),
      mediaType: 'image/png',
    })

    await testDb.db.insert(schema.files).values({
      userId,
      storageKey,
      name: 'doop-get_frame_screenshot.png',
      size: RED_PNG_BYTES,
      type: 'image/png',
      source: 'connector',
    })
    storage.head.mockResolvedValue(null)

    const saver = createSaver()

    expect(await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })).toEqual(['saved'])
    expect(persist).not.toHaveBeenCalled()
    expect(storage.put).toHaveBeenCalledWith(
      storageKey,
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: 'image/png' },
      }),
    )
    expect(Buffer.from(storage.put.mock.calls[0]![1]).toString('base64'))
      .toBe(RED_PNG_BASE64)
  })

  it('reuses the row a concurrent send inserted first', async () => {
    persist.mockImplementation(async (input: { storageKey: string }) => {
      await testDb.db.insert(schema.files).values({
        userId,
        storageKey: input.storageKey,
        name: 'from-the-other-send.png',
        size: RED_PNG_BYTES,
        type: 'image/png',
        source: 'connector',
      })

      throw Object.assign(new Error('taken'), { code: 'storage_key_taken' })
    })

    const saver = createSaver()

    expect(await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })).toEqual(['saved'])
    expect(saver.partsFor('call-1')[0]).toMatchObject({
      name: 'from-the-other-send.png',
    })
    expect(logger.set).not.toHaveBeenCalledWith(expect.objectContaining({
      attributes: { connectors: expect.objectContaining({
        imageSaveError: expect.anything(),
      }) },
    }))
  })

  it('keys the same bytes differently in another chat', async () => {
    const contentHash = 'a'.repeat(64)

    expect(await buildConnectorImageStorageKey({
      userId: 1,
      chatPublicId: 'chat-a',
      contentHash,
      mediaType: 'image/png',
    })).not.toBe(await buildConnectorImageStorageKey({
      userId: 1,
      chatPublicId: 'chat-b',
      contentHash,
      mediaType: 'image/png',
    }))
  })

  it('reports a full storage without failing and saves nothing', async () => {
    persist.mockRejectedValue(createStorageFullError({
      usedBytes: 100,
      totalBytes: 100,
    }))

    const saver = createSaver()

    expect(await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG],
    })).toEqual(['storage-full'])
    expect(saver.partsFor('call-1')).toEqual([])
  })

  it('reports any other failure as not kept and logs it', async () => {
    persist.mockRejectedValueOnce(new Error('R2 down'))

    const saver = createSaver()

    expect(await saver.save({
      toolCallId: 'call-1',
      connectorSlug: 'doop',
      toolName: 'get_frame_screenshot',
      images: [RED_PNG, GIF],
    })).toEqual(['not-saved', 'saved'])
    expect(saver.partsFor('call-1')).toHaveLength(1)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { connectors: { imageSaveError: 'R2 down' } },
    })
  })

  it('builds file names only from the slug and the tool name', () => {
    expect(buildConnectorImageFileName({
      connectorSlug: 'doop',
      toolName: '../../etc/passwd <script>',
      index: 2,
      mediaType: 'image/webp',
    })).toBe('doop-etc-passwd-script-3.webp')
    expect(buildConnectorImageFileName({
      connectorSlug: '',
      toolName: '***',
      index: 0,
      mediaType: 'image/jpeg',
    })).toBe('connector-connector.jpg')
  })
})
