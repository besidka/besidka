import type { CodeExecutionProvider } from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { CODE_EXECUTION_MAX_FILE_BYTES } from '#shared/utils/code-execution'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const CONTAINER_FILE_DOWNLOAD_TIMEOUT_MS = 30_000
export const ANTHROPIC_API_VERSION = '2023-06-01'
export const ANTHROPIC_FILES_BETA = 'files-api-2025-04-14'

const ANTHROPIC_FILES_URL = 'https://api.anthropic.com/v1/files'
const OPENAI_CONTAINERS_URL = 'https://api.openai.com/v1/containers'
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
const ANTHROPIC_OUTPUT_TYPES = new Set([
  'code_execution_output',
  'bash_code_execution_output',
])

export type ContainerFileRef
  = | { provider: 'anthropic', fileId: string }
    | {
      provider: 'openai'
      fileId: string
      containerId: string
      filename: string
    }

export type ContainerFileDownloadFailure = 'too-large' | 'download-failed'

export type ContainerFileDownload
  = | { ok: true, bytes: Uint8Array, filename: string | null }
    | { ok: false, reason: ContainerFileDownloadFailure }

export interface DownloadContainerFileInput {
  ref: ContainerFileRef
  apiKey: string
  maxBytes?: number
  fetcher?: typeof fetch
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value)
}

/**
 * Anthropic reports a produced file as `content[].file_id` on a code
 * execution result; the other result kinds carry none.
 */
export function collectAnthropicContainerFileRefs(
  output: unknown,
): ContainerFileRef[] {
  const content = readRecord(output)?.content

  if (!Array.isArray(content)) {
    return []
  }

  const refs: ContainerFileRef[] = []

  for (const entry of content) {
    const record = readRecord(entry)

    if (
      record
      && typeof record.type === 'string'
      && ANTHROPIC_OUTPUT_TYPES.has(record.type)
      && isSafeId(record.file_id)
    ) {
      refs.push({ provider: 'anthropic', fileId: record.file_id })
    }
  }

  return refs
}

/**
 * OpenAI reports a produced file as a `container_file_citation` annotation,
 * which the AI SDK maps to a `source-document` chunk whose provider metadata
 * holds the container and file ids.
 */
export function readOpenAiContainerFileCitation(chunk: {
  filename?: unknown
  title?: unknown
  providerMetadata?: unknown
}): ContainerFileRef | null {
  const metadata = readRecord(readRecord(chunk.providerMetadata)?.openai)

  if (
    !metadata
    || metadata.type !== 'container_file_citation'
    || !isSafeId(metadata.fileId)
    || !isSafeId(metadata.containerId)
  ) {
    return null
  }

  const filename = typeof chunk.filename === 'string' && chunk.filename
    ? chunk.filename
    : typeof chunk.title === 'string' ? chunk.title : ''

  return {
    provider: 'openai',
    fileId: metadata.fileId,
    containerId: metadata.containerId,
    filename,
  }
}

export function isContainerFileCitationChunk(chunk: {
  providerMetadata?: unknown
}): boolean {
  const metadata = readRecord(readRecord(chunk.providerMetadata)?.openai)

  return metadata?.type === 'container_file_citation'
}

/**
 * `@ai-sdk/openai` also reports each `container_file_citation` inside the
 * text part's provider metadata, next to the `source-document` chunk. Those
 * entries carry the provider's container and file ids, so they are removed
 * wherever the stream or a finished message could keep them.
 */
export function stripContainerFileAnnotations<TMetadata>(
  providerMetadata: TMetadata,
): TMetadata {
  const metadata = readRecord(providerMetadata)
  const openai = readRecord(metadata?.openai)

  if (!metadata || !openai || !Array.isArray(openai.annotations)) {
    return providerMetadata
  }

  const annotations = openai.annotations.filter((annotation) => {
    return readRecord(annotation)?.type !== 'container_file_citation'
  })

  if (annotations.length === openai.annotations.length) {
    return providerMetadata
  }

  return {
    ...metadata,
    openai: { ...openai, annotations },
  } as TMetadata
}

export function getContainerFileKey(ref: ContainerFileRef): string {
  return ref.provider === 'openai'
    ? `openai:${ref.containerId}:${ref.fileId}`
    : `anthropic:${ref.fileId}`
}

export function buildAuthHeaders(
  provider: CodeExecutionProvider,
  apiKey: string,
): Record<string, string> {
  if (provider === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-beta': ANTHROPIC_FILES_BETA,
    }
  }

  return { Authorization: `Bearer ${apiKey}` }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel()

    return null
  }

  if (!response.body) {
    return new Uint8Array(0)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel()

      return null
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

async function requestProvider(
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch,
): Promise<Response> {
  return await fetcher(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(CONTAINER_FILE_DOWNLOAD_TIMEOUT_MS),
  })
}

async function readAnthropicFileName(
  fileId: string,
  headers: Record<string, string>,
  maxBytes: number,
  fetcher: typeof fetch,
): Promise<{ filename: string | null } | ContainerFileDownloadFailure> {
  const response = await requestProvider(
    `${ANTHROPIC_FILES_URL}/${fileId}`,
    headers,
    fetcher,
  )

  if (!response.ok) {
    await response.body?.cancel()

    return 'download-failed'
  }

  const metadata = readRecord(await response.json())
  const sizeBytes = metadata?.size_bytes

  if (typeof sizeBytes === 'number' && sizeBytes > maxBytes) {
    return 'too-large'
  }

  return {
    filename: typeof metadata?.filename === 'string'
      ? metadata.filename
      : null,
  }
}

/**
 * Downloads one container output file with the user's own key. Sequential by
 * design (the Worker allows 6 simultaneous connections), size-capped by
 * `Content-Length` and again while streaming, 30 s timeout, and
 * `redirect: 'manual'` because workerd throws on `redirect: 'error'`; a
 * redirect is a failure, never followed with credentials attached.
 */
export async function downloadContainerFile(
  input: DownloadContainerFileInput,
  logger: LoggerLike,
): Promise<ContainerFileDownload> {
  const maxBytes = input.maxBytes ?? CODE_EXECUTION_MAX_FILE_BYTES
  const fetcher = input.fetcher ?? fetch
  const headers = buildAuthHeaders(input.ref.provider, input.apiKey)

  try {
    let filename: string | null = null
    let contentUrl: string

    if (input.ref.provider === 'anthropic') {
      const metadata = await readAnthropicFileName(
        input.ref.fileId,
        headers,
        maxBytes,
        fetcher,
      )

      if (typeof metadata === 'string') {
        return { ok: false, reason: metadata }
      }

      filename = metadata.filename
      contentUrl = `${ANTHROPIC_FILES_URL}/${input.ref.fileId}/content`
    } else {
      filename = input.ref.filename || null
      contentUrl = `${OPENAI_CONTAINERS_URL}/${input.ref.containerId}`
        + `/files/${input.ref.fileId}/content`
    }

    const response = await requestProvider(contentUrl, headers, fetcher)

    if (!response.ok) {
      await response.body?.cancel()
      logger.set({
        attributes: {
          codeExecutionDownload: {
            provider: input.ref.provider,
            status: response.status,
          },
        },
      })

      return { ok: false, reason: 'download-failed' }
    }

    const bytes = await readBounded(response, maxBytes)

    if (!bytes) {
      return { ok: false, reason: 'too-large' }
    }

    return { ok: true, bytes, filename }
  } catch (exception) {
    logger.set({
      attributes: {
        codeExecutionDownload: {
          provider: input.ref.provider,
          error: exceptionMessage(exception),
        },
      },
    })

    return { ok: false, reason: 'download-failed' }
  }
}
