import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'
import { toConnectorImageChatMarker } from '#shared/utils/connector-image-parts'
import { getPreferredFileExtension } from '#shared/utils/files'
import * as schema from '~~/server/db/schema'
import { readConnectorIconDimensions } from '~~/server/utils/connectors/icon'
import type { ConnectorImageSaveStatus } from '~~/server/utils/connectors/image-placeholders'
import { createConcurrencyLimiter } from '~~/server/utils/connectors/mcp-client'
import {
  decodeConnectorImage,
} from '~~/server/utils/connectors/tool-images'
import type { ConnectorForwardedImage } from '~~/server/utils/connectors/tool-images'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  isStorageKeyTakenError,
  persistFile,
} from '~~/server/utils/files/persist-file'
import { isStorageFullError } from '~~/server/utils/storage/errors'

type DbClient = ReturnType<typeof useDb>

const STORAGE_KEY_PREFIX = 'connector-'
const NAME_PART_MAX_LENGTH = 48
const NAME_UNSAFE_CHARACTERS = /[^A-Za-z0-9_-]+/g
const NAME_EDGE_SEPARATORS = /^[-_]+|[-_]+$/g
const FALLBACK_NAME_PART = 'connector'
const MAX_LINK_BATCH_IDS = 90

export interface ConnectorImageSaveInput {
  toolCallId: string
  connectorSlug: string
  toolName: string
  images: readonly ConnectorForwardedImage[]
}

export interface ConnectorImageSaver {
  save: (
    input: ConnectorImageSaveInput,
  ) => Promise<ConnectorImageSaveStatus[]>
  partsFor: (toolCallId: string) => ConnectorImagePartData[]
}

export interface CreateConnectorImageSaverInput {
  db: DbClient
  userId: number
  chatPublicId: string
  logger: LoggerLike
  persist?: typeof persistFile
  storage?: Pick<ReturnType<typeof useFileStorage>, 'head' | 'put'>
}

interface StoredImage {
  fileId: string
  url: string
  size: number
  name: string
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(
  data: Uint8Array<ArrayBuffer> | string,
): Promise<string> {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data

  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

function toNamePart(value: string): string {
  const cleaned = value
    .replace(NAME_UNSAFE_CHARACTERS, '-')
    .replace(NAME_EDGE_SEPARATORS, '')
    .slice(0, NAME_PART_MAX_LENGTH)

  return cleaned || FALLBACK_NAME_PART
}

/**
 * The file name of a saved connector image, built only from the connector
 * slug and the tool name Besidka holds, never from anything in the result:
 * `doop-get_frame_screenshot.png`, then `-2`, `-3` for more images of the
 * same call.
 */
export function buildConnectorImageFileName(input: {
  connectorSlug: string
  toolName: string
  index: number
  mediaType: string
}): string {
  const suffix = input.index > 0 ? `-${input.index + 1}` : ''

  return `${toNamePart(input.connectorSlug)}-${toNamePart(input.toolName)}`
    + `${suffix}.${getPreferredFileExtension(input.mediaType)}`
}

/**
 * The R2 key of a saved connector image: the hash of the user, the chat and
 * the image bytes, so the same screenshot in the same chat maps to one file
 * and is found again without a hash column.
 */
export async function buildConnectorImageStorageKey(input: {
  userId: number
  chatPublicId: string
  contentHash: string
  mediaType: string
}): Promise<string> {
  const keyHash = await sha256Hex(
    `${input.userId}:${input.chatPublicId}:${input.contentHash}`,
  )

  return `${STORAGE_KEY_PREFIX}${keyHash}.${
    getPreferredFileExtension(input.mediaType)
  }`
}

/**
 * Saves the images a connector call showed to the model as the user's files
 * (`files.source = 'connector'`), for one send. Saves run one at a time
 * (one limiter slot), so the R2 puts are sequential and the lookup before
 * each insert cannot race within the send. An image already saved in this
 * chat (same bytes) reuses its file row instead of a second copy; a reused
 * row whose R2 object is gone gets the bytes back, and a concurrent send
 * that inserted the same key first is reused instead of failing. A full
 * storage or any other failure never throws: that image gets
 * `storage-full` or `not-saved` and the call goes on. No AI provenance mark
 * is added, because a connector image is not AI-generated. The chat marker
 * goes into `origin_provider` (`toConnectorImageChatMarker`), and
 * `originMessageId` is set when the reply is stored
 * (`linkConnectorImagesToMessage`). The saved image metadata stays
 * readable after the send's images are cleared, for the stream parts.
 */
export function createConnectorImageSaver(
  input: CreateConnectorImageSaverInput,
): ConnectorImageSaver {
  const persist = input.persist ?? persistFile
  const limiter = createConcurrencyLimiter(1)
  const partsByCallId = new Map<string, ConnectorImagePartData[]>()
  const storedByKey = new Map<string, StoredImage>()

  async function findStoredRow(
    storageKey: string,
  ): Promise<StoredImage | null> {
    const row = await input.db
      .select({
        id: schema.files.id,
        size: schema.files.size,
        name: schema.files.name,
      })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, input.userId),
        eq(schema.files.storageKey, storageKey),
      ))
      .get()

    return row
      ? {
        fileId: row.id,
        url: `/files/${storageKey}`,
        size: row.size,
        name: row.name,
      }
      : null
  }

  async function ensureObject(
    storageKey: string,
    image: ConnectorForwardedImage,
    bytes: Uint8Array<ArrayBuffer>,
    name: string,
  ): Promise<void> {
    const storage = input.storage ?? useFileStorage()

    if (await storage.head(storageKey)) {
      return
    }

    await storage.put(storageKey, bytes, {
      httpMetadata: { contentType: image.mediaType },
      customMetadata: { name },
    })
    input.logger.set({
      attributes: { connectors: { imageObjectRestored: true } },
    })
  }

  async function reuse(
    storageKey: string,
    image: ConnectorForwardedImage,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<StoredImage | null> {
    const known = storedByKey.get(storageKey)

    if (known) {
      return known
    }

    const stored = await findStoredRow(storageKey)

    if (!stored) {
      return null
    }

    await ensureObject(storageKey, image, bytes, stored.name)
    storedByKey.set(storageKey, stored)

    return stored
  }

  async function persistNew(
    storageKey: string,
    image: ConnectorForwardedImage,
    bytes: Uint8Array<ArrayBuffer>,
    name: string,
  ): Promise<StoredImage | null> {
    try {
      const persisted = await persist({
        userId: input.userId,
        fileName: name,
        mediaType: image.mediaType,
        fileData: bytes,
        source: 'connector',
        storageKey,
        originProvider: toConnectorImageChatMarker(input.chatPublicId),
        logger: input.logger,
      })

      return {
        fileId: persisted.id,
        url: `/files/${persisted.storageKey}`,
        size: persisted.size,
        name: persisted.name,
      }
    } catch (exception) {
      if (!isStorageKeyTakenError(exception)) {
        throw exception
      }

      return await reuse(storageKey, image, bytes)
    }
  }

  async function saveOne(
    image: ConnectorForwardedImage,
    name: string,
  ): Promise<
    | { status: 'saved', stored: StoredImage, width: number, height: number }
    | { status: Exclude<ConnectorImageSaveStatus, 'saved'> }
  > {
    const bytes = decodeConnectorImage(image)
    const dimensions = bytes
      ? readConnectorIconDimensions(bytes, image.mediaType)
      : null

    if (!bytes || !dimensions) {
      return { status: 'not-saved' }
    }

    const storageKey = await buildConnectorImageStorageKey({
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      contentHash: await sha256Hex(bytes),
      mediaType: image.mediaType,
    })
    const stored = await reuse(storageKey, image, bytes)
      ?? await persistNew(storageKey, image, bytes, name)

    if (!stored) {
      return { status: 'not-saved' }
    }

    storedByKey.set(storageKey, stored)

    return {
      status: 'saved',
      stored,
      width: dimensions.width,
      height: dimensions.height,
    }
  }

  async function saveAll(
    request: ConnectorImageSaveInput,
  ): Promise<ConnectorImageSaveStatus[]> {
    const statuses: ConnectorImageSaveStatus[] = []
    const parts: ConnectorImagePartData[] = []

    for (const [index, image] of request.images.entries()) {
      const name = buildConnectorImageFileName({
        connectorSlug: request.connectorSlug,
        toolName: request.toolName,
        index,
        mediaType: image.mediaType,
      })

      try {
        const outcome = await saveOne(image, name)

        statuses.push(outcome.status)

        if (outcome.status === 'saved') {
          parts.push({
            toolCallId: request.toolCallId,
            fileId: outcome.stored.fileId,
            url: outcome.stored.url,
            mediaType: image.mediaType,
            width: outcome.width,
            height: outcome.height,
            size: outcome.stored.size,
            name: outcome.stored.name,
          })
        }
      } catch (exception) {
        const isFull = isStorageFullError(exception)

        statuses.push(isFull ? 'storage-full' : 'not-saved')

        if (!isFull) {
          input.logger.set({
            attributes: {
              connectors: {
                imageSaveError: exceptionMessage(exception),
              },
            },
          })
        }
      }
    }

    partsByCallId.set(request.toolCallId, parts)

    return statuses
  }

  return {
    async save(request) {
      if (request.images.length === 0) {
        partsByCallId.delete(request.toolCallId)

        return []
      }

      return await limiter.run(() => saveAll(request))
    },
    partsFor(toolCallId) {
      return partsByCallId.get(toolCallId) ?? []
    },
  }
}

/**
 * Points the connector images a stored reply shows at that reply
 * (`files.origin_message_id`), so deleting the chat or the message deletes
 * them like generated images. Only rows with no origin yet are set: an image
 * reused from an earlier message of the chat keeps its first origin, and the
 * reference check on deletion keeps it while a later step still shows it.
 */
export async function linkConnectorImagesToMessage(
  db: DbClient,
  input: {
    userId: number
    messagePublicId: string
    fileIds: readonly string[]
  },
  logger: LoggerLike,
): Promise<void> {
  for (
    let offset = 0;
    offset < input.fileIds.length;
    offset += MAX_LINK_BATCH_IDS
  ) {
    const chunk = input.fileIds.slice(offset, offset + MAX_LINK_BATCH_IDS)

    try {
      await db
        .update(schema.files)
        .set({
          originMessageId: sql`(
            select ${schema.messages.id}
            from ${schema.messages}
            where ${schema.messages.publicId} = ${input.messagePublicId}
          )`,
        })
        .where(and(
          eq(schema.files.userId, input.userId),
          eq(schema.files.source, 'connector'),
          isNull(schema.files.originMessageId),
          inArray(schema.files.id, chunk),
        ))
    } catch (exception) {
      logger.set({
        attributes: {
          connectors: {
            imageLinkError: exceptionMessage(exception),
            imageLinkCount: chunk.length,
          },
        },
      })
    }
  }
}
