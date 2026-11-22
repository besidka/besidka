import type { ModelMessage, ToolResultPart } from 'ai'
import { getConnectorImagesForToolCall } from '#shared/utils/connector-image-parts'
import {
  CONNECTOR_IMAGE_MAX_BYTES,
  CONNECTOR_IMAGES_MAX_BYTES_PER_SEND,
  CONNECTOR_IMAGES_PER_SEND,
  isConnectorImageMediaType,
} from '#shared/utils/connectors-policy'
import {
  getConnectorToolPartName,
  isFramedConnectorOutput,
  parseConnectorToolName,
} from '#shared/utils/connectors-parts'
import { sniffConnectorIconType } from '~~/server/utils/connectors/icon'
import {
  countKeptConnectorImageLines,
} from '~~/server/utils/connectors/image-placeholders'
import {
  buildConnectorModelOutput,
  isUsableConnectorImage,
} from '~~/server/utils/connectors/tool-images'
import type {
  ConnectorForwardedImage,
  ConnectorImageUsage,
} from '~~/server/utils/connectors/tool-images'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  findChatConnectorImageFilesByIds,
} from '~~/server/utils/files/connector-images'
import type {
  ChatConnectorImageFile,
} from '~~/server/utils/files/connector-images'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const FINISHED_STATE = 'output-available'

export interface KeptConnectorImageCall {
  toolName: string
  connectorTitle: string
  images: ConnectorForwardedImage[]
  keptIndexes: number[]
}

export interface KeptConnectorImages {
  calls: Map<string, KeptConnectorImageCall>
  usage: ConnectorImageUsage
}

export interface LoadKeptConnectorImagesInput {
  db: DbClient
  userId: number
  chatPublicId: string
  parts: readonly unknown[]
  connectorTitles: ReadonlyMap<string, string>
  storage?: Pick<ReturnType<typeof useFileStorage>, 'get'>
  logger: LoggerLike
}

interface KeptImageReference {
  toolCallId: string
  toolName: string
  connectorTitle: string
  keptIndex: number
  fileId: string
}

interface SelectedImage {
  reference: KeptImageReference
  file: ChatConnectorImageFile
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyKeptImages(): KeptConnectorImages {
  return { calls: new Map(), usage: { count: 0, bytes: 0 } }
}

/**
 * The kept images of a message's finished connector calls, in the order the
 * calls ran. A call whose kept lines and saved image parts disagree in
 * number is left out, so a line never stands for the wrong image, and so is
 * a call of a connector the user no longer has.
 */
function collectKeptImageReferences(
  parts: readonly unknown[],
  connectorTitles: ReadonlyMap<string, string>,
): KeptImageReference[] {
  const references: KeptImageReference[] = []

  for (const part of parts) {
    const toolName = getConnectorToolPartName(part)
    const parsed = toolName ? parseConnectorToolName(toolName) : null

    if (
      !toolName
      || !parsed
      || !isRecord(part)
      || part.state !== FINISHED_STATE
      || typeof part.toolCallId !== 'string'
      || !isFramedConnectorOutput(part.output)
    ) {
      continue
    }

    const connectorTitle = connectorTitles.get(parsed.slug)
    const images = getConnectorImagesForToolCall(parts, part.toolCallId)

    if (
      !connectorTitle
      || images.length === 0
      || images.length !== countKeptConnectorImageLines(part.output)
    ) {
      continue
    }

    for (const [keptIndex, image] of images.entries()) {
      references.push({
        toolCallId: part.toolCallId,
        toolName,
        connectorTitle,
        keptIndex,
        fileId: image.fileId,
      })
    }
  }

  return references
}

/**
 * The newest kept images that fit the send's caps by their stored size,
 * newest first. A missing file is skipped; the first image that does not fit
 * stops the selection, so only older images are left as text.
 */
function selectNewestWithinCaps(
  references: readonly KeptImageReference[],
  filesById: ReadonlyMap<string, ChatConnectorImageFile>,
): SelectedImage[] {
  const selected: SelectedImage[] = []
  let bytes = 0

  for (const reference of [...references].reverse()) {
    const file = filesById.get(reference.fileId)

    if (!file || file.size <= 0 || file.size > CONNECTOR_IMAGE_MAX_BYTES) {
      continue
    }

    if (
      selected.length >= CONNECTOR_IMAGES_PER_SEND
      || bytes + file.size > CONNECTOR_IMAGES_MAX_BYTES_PER_SEND
    ) {
      break
    }

    selected.push({ reference, file })
    bytes += file.size
  }

  return selected
}

/**
 * The image bytes of a kept file, checked again on every read: the type
 * comes from the magic bytes (the stored media type is never trusted), and
 * the structure and size must pass the same checks as a forwarded image.
 */
async function readKeptImage(
  storage: Pick<ReturnType<typeof useFileStorage>, 'get'>,
  file: ChatConnectorImageFile,
): Promise<ConnectorForwardedImage | null> {
  const object = await storage.get(file.storageKey)

  if (!object) {
    return null
  }

  const bytes = new Uint8Array(await object.arrayBuffer())

  if (bytes.length === 0 || bytes.length > CONNECTOR_IMAGE_MAX_BYTES) {
    return null
  }

  const mediaType = sniffConnectorIconType(bytes)

  if (
    !isConnectorImageMediaType(mediaType)
    || !isUsableConnectorImage(bytes, mediaType)
  ) {
    return null
  }

  return {
    mediaType,
    data: Buffer.from(bytes).toString('base64'),
    bytes: bytes.length,
  }
}

/**
 * The loaded images by call, in the order the calls ran and, within a call,
 * in the order it returned them (`loaded` is newest first).
 */
function groupByCall(
  loaded: ReadonlyArray<{
    reference: KeptImageReference
    image: ConnectorForwardedImage
  }>,
): Map<string, KeptConnectorImageCall> {
  const calls = new Map<string, KeptConnectorImageCall>()

  for (const { reference, image } of [...loaded].reverse()) {
    const call = calls.get(reference.toolCallId) ?? {
      toolName: reference.toolName,
      connectorTitle: reference.connectorTitle,
      images: [],
      keptIndexes: [],
    }

    call.images.push(image)
    call.keptIndexes.push(reference.keptIndex)
    calls.set(reference.toolCallId, call)
  }

  return calls
}

/**
 * The images an approval continuation shows to the model again: the kept
 * images (`data-connector-image` parts) of the paused message's finished
 * connector calls, newest first within `CONNECTOR_IMAGES_PER_SEND` and
 * `CONNECTOR_IMAGES_MAX_BYTES_PER_SEND`, so the model sees every screenshot
 * it already saw before the pause. Only files of this user and this chat
 * with `source = 'connector'` are read, one R2 read at a time and once per
 * file. A missing row or object, or bytes that fail the image checks, leave
 * that image as text. It never throws: a failure leaves every image as text.
 */
export async function loadKeptConnectorImages(
  input: LoadKeptConnectorImagesInput,
): Promise<KeptConnectorImages> {
  const references = collectKeptImageReferences(
    input.parts,
    input.connectorTitles,
  )

  if (references.length === 0) {
    return emptyKeptImages()
  }

  try {
    const files = await findChatConnectorImageFilesByIds(input.db, {
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      fileIds: [...new Set(references.map(reference => reference.fileId))],
    })
    const filesById = new Map(files.map(file => [file.id, file]))
    const selected = selectNewestWithinCaps(references, filesById)
    const storage = input.storage ?? useFileStorage()
    const imagesByFileId = new Map<string, ConnectorForwardedImage | null>()
    const loaded: Array<{
      reference: KeptImageReference
      image: ConnectorForwardedImage
    }> = []
    let bytes = 0

    for (const { reference, file } of selected) {
      if (!imagesByFileId.has(file.id)) {
        imagesByFileId.set(file.id, await readKeptImage(storage, file))
      }

      const image = imagesByFileId.get(file.id)

      if (
        !image
        || bytes + image.bytes > CONNECTOR_IMAGES_MAX_BYTES_PER_SEND
      ) {
        continue
      }

      loaded.push({ reference, image })
      bytes += image.bytes
    }

    input.logger.set({
      attributes: {
        connectors: {
          keptImagesShownAgain: loaded.length,
          keptImagesLeftAsText: references.length - loaded.length,
        },
      },
    })

    return {
      calls: groupByCall(loaded),
      usage: { count: loaded.length, bytes },
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        connectors: {
          keptImagesError: exceptionMessage(exception),
          keptImagesLeftAsText: references.length,
        },
      },
    })

    return emptyKeptImages()
  }
}

/**
 * For `buildResumedAssistantMessages`: per tool call id, which kept lines of
 * the call go to the model again.
 */
export function keptConnectorImageLineIndexes(
  kept: KeptConnectorImages,
): Map<string, Set<number>> {
  return new Map([...kept.calls].map(([toolCallId, call]) => {
    return [toolCallId, new Set(call.keptIndexes)]
  }))
}

function withKeptImages(
  part: ToolResultPart,
  call: KeptConnectorImageCall,
): ToolResultPart {
  if (part.output.type !== 'text') {
    return part
  }

  return {
    ...part,
    output: buildConnectorModelOutput({
      output: part.output.value,
      images: call.images,
      connectorTitle: call.connectorTitle,
      toolName: call.toolName,
    }),
  }
}

/**
 * Puts the kept images back into the tool results of the model messages, in
 * the same shape the tool's `toModelOutput` gave them before the pause: the
 * text, the provenance note (data, never instructions), then one `file`
 * part per image. Only results whose call is in `kept` change, and only a
 * plain text output, which is how a replayed connector result arrives.
 */
export function attachKeptConnectorImages(
  messages: readonly ModelMessage[],
  kept: KeptConnectorImages,
): ModelMessage[] {
  if (kept.calls.size === 0) {
    return [...messages]
  }

  return messages.map((message) => {
    if (message.role !== 'tool') {
      return message
    }

    return {
      ...message,
      content: message.content.map((part) => {
        const call = part.type === 'tool-result'
          ? kept.calls.get(part.toolCallId)
          : undefined

        return call && part.type === 'tool-result'
          ? withKeptImages(part, call)
          : part
      }),
    }
  })
}
