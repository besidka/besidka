import { createError } from 'evlog'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type {
  DocumentRendererService,
  ExtractRequest,
  ExtractResult,
  RendererCapabilities,
  RenderFailureCode,
  RenderRequest,
  RenderResult,
  ValidateRequest,
  ValidateResult,
} from '~~/workers/doc-renderer/src/contract'

type RendererOperation = 'capabilities' | 'render' | 'validate' | 'extract'

export const RENDERER_CAPABILITIES_TTL_MS = 5 * 60 * 1000

const UNAVAILABLE_MESSAGE = 'Document rendering is unavailable'

let cachedCapabilities: {
  value: RendererCapabilities
  expiresAt: number
} | null = null

export function resetRendererCapabilitiesCache(): void {
  cachedCapabilities = null
}

function createUnavailableError(why: string) {
  return createError({
    message: UNAVAILABLE_MESSAGE,
    status: 503,
    why,
    fix: 'Try again later',
  })
}

/**
 * Captures the `DOC_RENDERER` service binding. It is absent in local
 * development without a second `wrangler dev` session and wherever the
 * satellite Worker is not deployed; both end in the same 503, and the
 * `documents` features report themselves off through `requires.bindings`.
 */
export function getDocumentRenderer(): DocumentRendererService {
  const { DOC_RENDERER } = env as unknown as {
    DOC_RENDERER?: DocumentRendererService
  }

  if (!DOC_RENDERER) {
    throw createUnavailableError('DOC_RENDERER binding missing')
  }

  return DOC_RENDERER
}

const LOGGED_FORMATS: readonly string[] = ['pdf', 'docx', 'pptx', 'xlsx']

function readFormat(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const { format } = value as { format?: unknown }

  return typeof format === 'string' && LOGGED_FORMATS.includes(format)
    ? format
    : null
}

function setRendererLog(
  logger: LoggerLike | undefined,
  fields: {
    operation: RendererOperation
    format?: string | null
    ok: boolean
    code?: string
    durationMs: number
    bytes?: number
    rendererVersion?: string
    status?: string
    textBytes?: number
    truncated?: boolean
  },
): void {
  logger?.set({
    attributes: {
      documents: {
        renderer: { [fields.operation]: fields },
      },
    },
  })
}

async function callRenderer<Result>(
  operation: RendererOperation,
  logger: LoggerLike | undefined,
  call: (renderer: DocumentRendererService) => Promise<Result>,
  format: string | null,
): Promise<Result> {
  const renderer = getDocumentRenderer()
  const startedAt = Date.now()

  try {
    return await call(renderer)
  } catch (exception) {
    setRendererLog(logger, {
      operation,
      format,
      ok: false,
      code: 'binding_call_failed',
      durationMs: Date.now() - startedAt,
    })
    logger?.set({
      attributes: {
        documents: { rendererError: exceptionSummary(exception) },
      },
    })

    throw createUnavailableError('The DOC_RENDERER call failed')
  }
}

export async function getRendererCapabilities(
  logger?: LoggerLike,
): Promise<RendererCapabilities> {
  const now = Date.now()

  if (cachedCapabilities && cachedCapabilities.expiresAt > now) {
    return cachedCapabilities.value
  }

  const startedAt = now
  const value = await callRenderer(
    'capabilities',
    logger,
    renderer => renderer.capabilities(),
    null,
  )

  cachedCapabilities = {
    value,
    expiresAt: Date.now() + RENDERER_CAPABILITIES_TTL_MS,
  }
  setRendererLog(logger, {
    operation: 'capabilities',
    ok: true,
    durationMs: Date.now() - startedAt,
    rendererVersion: value.rendererVersion,
  })

  return value
}

/**
 * Renders through the binding. A spec version the renderer does not list is
 * answered with `spec_version_unsupported` without a render call, which
 * protects previews and staggered deploys where app and renderer differ.
 * Failures of the document itself come back as values; only an unusable
 * binding throws (503).
 */
export async function renderDocument(
  request: RenderRequest,
  logger: LoggerLike,
): Promise<RenderResult> {
  const format = readFormat(request.spec)
  const capabilities = await getRendererCapabilities(logger)

  if (!capabilities.specVersions.includes(request.specVersion)) {
    setRendererLog(logger, {
      operation: 'render',
      format,
      ok: false,
      code: 'spec_version_unsupported',
      durationMs: 0,
      rendererVersion: capabilities.rendererVersion,
    })

    return {
      ok: false,
      code: 'spec_version_unsupported',
      detail: `The renderer supports spec versions ${
        capabilities.specVersions.join(', ')
      }`,
    }
  }

  const startedAt = Date.now()
  const result = await callRenderer(
    'render',
    logger,
    renderer => renderer.render(request),
    format,
  )

  setRendererLog(logger, {
    operation: 'render',
    format,
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    durationMs: Date.now() - startedAt,
    bytes: result.ok ? result.bytes.length : undefined,
    rendererVersion: result.ok
      ? result.rendererVersion
      : capabilities.rendererVersion,
  })

  return result
}

export async function validateDocumentBytes(
  request: ValidateRequest,
  logger: LoggerLike,
): Promise<ValidateResult> {
  const format = readFormat(request)
  const startedAt = Date.now()
  const result = await callRenderer(
    'validate',
    logger,
    renderer => renderer.validate(request),
    format,
  )

  setRendererLog(logger, {
    operation: 'validate',
    format,
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    durationMs: Date.now() - startedAt,
    bytes: request.bytes?.length,
  })

  return result
}

const RENDERER_UNAVAILABLE_CODE = 'renderer_unavailable'
const EXTRACT_CRASHED_CODE = 'extract_crashed'
const FILE_TOO_LARGE_CODE = 'file_too_large'
const SUPPORTED_EXTRACT_VERSIONS: readonly number[] = [1]

function createExtraction(
  request: ExtractRequest,
  status: ExtractResult['status'],
  errorCode: string,
): ExtractResult {
  return {
    status,
    text: '',
    truncated: false,
    stats: {
      inputBytes: request.bytes.byteLength,
      entries: 0,
      textBytes: 0,
      truncations: [],
    },
    errorCode,
  }
}

/**
 * Extracts Markdown text from a DOCX, XLSX or PPTX through the binding. It
 * never throws, and separates the failures a caller may retry from the ones
 * it may not:
 * - `renderer_unavailable` (`failed`, retry later): no binding, a satellite
 *   deployed before `extract` existed or with another `extract` version, or
 *   a satellite that does not list the format;
 * - `file_too_large` (`too_large`): the file is over the satellite's
 *   `maxInputBytes`, answered without a call because a larger RPC payload
 *   would throw;
 * - `extract_crashed` (`failed`, do not retry): the call threw on a
 *   satellite that supports `extract`, for instance CPU or memory exceeded,
 *   which the same file will do again.
 * Only sizes and codes are logged, never the text.
 */
export async function extractOfficeText(
  request: ExtractRequest,
  logger?: LoggerLike,
): Promise<ExtractResult> {
  const startedAt = Date.now()
  let capabilities: RendererCapabilities

  try {
    capabilities = await getRendererCapabilities(logger)
  } catch {
    setRendererLog(logger, {
      operation: 'extract',
      format: request.format,
      ok: false,
      code: RENDERER_UNAVAILABLE_CODE,
      durationMs: Date.now() - startedAt,
    })

    return createExtraction(request, 'failed', RENDERER_UNAVAILABLE_CODE)
  }

  const extract = capabilities.extract
  const isSupported = extract !== undefined
    && extract.formats.includes(request.format)
    && SUPPORTED_EXTRACT_VERSIONS.includes(extract.version)

  if (!isSupported) {
    setRendererLog(logger, {
      operation: 'extract',
      format: request.format,
      ok: false,
      code: RENDERER_UNAVAILABLE_CODE,
      durationMs: Date.now() - startedAt,
      rendererVersion: capabilities.rendererVersion,
    })

    return createExtraction(request, 'failed', RENDERER_UNAVAILABLE_CODE)
  }

  if (request.bytes.byteLength > extract.maxInputBytes) {
    setRendererLog(logger, {
      operation: 'extract',
      format: request.format,
      ok: false,
      code: FILE_TOO_LARGE_CODE,
      status: 'too_large',
      durationMs: Date.now() - startedAt,
      bytes: request.bytes.byteLength,
      rendererVersion: capabilities.rendererVersion,
    })

    return createExtraction(request, 'too_large', FILE_TOO_LARGE_CODE)
  }

  try {
    const result = await callRenderer(
      'extract',
      logger,
      renderer => renderer.extract(request),
      request.format,
    )

    setRendererLog(logger, {
      operation: 'extract',
      format: request.format,
      ok: result.status === 'ready' || result.status === 'empty',
      code: result.errorCode,
      status: result.status,
      durationMs: Date.now() - startedAt,
      bytes: request.bytes.byteLength,
      textBytes: result.stats.textBytes,
      truncated: result.truncated,
      rendererVersion: capabilities.rendererVersion,
    })

    return result
  } catch {
    setRendererLog(logger, {
      operation: 'extract',
      format: request.format,
      ok: false,
      code: EXTRACT_CRASHED_CODE,
      durationMs: Date.now() - startedAt,
      bytes: request.bytes.byteLength,
      rendererVersion: capabilities.rendererVersion,
    })

    return createExtraction(request, 'failed', EXTRACT_CRASHED_CODE)
  }
}

const CLIENT_FAILURE_CODES: readonly RenderFailureCode[] = [
  'spec_invalid',
  'bounds_exceeded',
  'asset_invalid',
]

/**
 * HTTP status for a failed render result. An unsupported spec version is a
 * 503 for chat, which falls back to the client render, and a 422 for the
 * other channels, which have no fallback and need a clear message.
 */
export function getRenderFailureStatus(
  code: RenderFailureCode,
  createdVia: RenderRequest['provenance']['createdVia'],
): number {
  if (code === 'spec_version_unsupported') {
    return createdVia === 'chat' ? 503 : 422
  }

  return CLIENT_FAILURE_CODES.includes(code) ? 422 : 500
}
