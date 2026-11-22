import type { KVNamespace } from '@cloudflare/workers-types'
import { eq, and } from 'drizzle-orm'
import { createError } from 'evlog'
import { collectImageIds } from '@besidka/doc-renderer/spec'
import type { DocumentSpec, SpecIssue } from '@besidka/doc-renderer/spec'
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_FEATURE_KEYS,
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_LABELS,
  DOCUMENT_MAX_FILE_BYTES,
  getDocumentFileName,
} from '#shared/utils/documents'
import type { DocumentFileRef, DocumentFormat } from '#shared/utils/documents'
import {
  MCP_DOCUMENT_RENDER_DAILY_LIMIT,
  MCP_DOCUMENT_RENDER_MINUTE_LIMIT,
} from '~~/config/mcp-server'
import * as schema from '~~/server/db/schema'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import {
  BLOCKS_DESCRIPTION,
  FORMAT_EXAMPLES,
  FORMAT_RULES,
  checkDocumentSpecInput,
  toDocumentStats,
  withSpecStats,
} from '~~/server/utils/documents/create-document-tool'
import {
  failClaimedDocument,
  finalizeRenderedDocument,
  setDocumentLog,
} from '~~/server/utils/documents/finalize'
import {
  loadDocumentImageAssets,
  resolveOwnedImageFiles,
} from '~~/server/utils/documents/images'
import { renderDocument } from '~~/server/utils/documents/renderer'
import {
  claimDocumentRender,
  createDocument,
  deleteDocumentSpecObjects,
} from '~~/server/utils/documents/store'
import type { DocumentRow } from '~~/server/utils/documents/store'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { formatFileSize } from '#shared/utils/files'
import { MCP_FILE_TEXT_MAX_CHARS } from '~~/server/utils/mcp/private/files'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'
import type { RenderSuccess } from '~~/workers/doc-renderer/src/contract'

type DbClient = ReturnType<typeof useDb>

type DocumentKv = Pick<KVNamespace, 'get' | 'put' | 'delete'>

export const MCP_DOCUMENT_TITLE_MAX_CHARS = 200
export const MCP_DOCUMENT_SPEC_MAX_CHARS = MCP_FILE_TEXT_MAX_CHARS
export const MCP_DOCUMENT_MAX_REPORTED_ISSUES = 10
export const MCP_DOCUMENT_UNAVAILABLE_MESSAGE
  = 'Document creation is not available for this account'

const DOCUMENT_MINUTE_LIMIT_KEY_PREFIX = 'mcp:rate-limit:document-minute'
const DOCUMENT_DAILY_LIMIT_KEY_PREFIX = 'mcp:rate-limit:document-day'
const LIMIT_BUSY_RETRY_AFTER_SECONDS = 1
const BYTES_PER_MEBIBYTE = 1024 * 1024
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

export interface McpDocumentContext {
  db: DbClient
  kv: DocumentKv
  userId: number
  logger: LoggerLike
}

export interface CreateMcpDocumentInput {
  format: DocumentFormat
  title: string
  spec: Record<string, unknown>
  fileName?: string
  aiGenerated?: boolean
}

function createUnavailableError() {
  return createError({
    message: MCP_DOCUMENT_UNAVAILABLE_MESSAGE,
    status: 404,
    why: 'feature_unavailable',
  })
}

function createRejectedError(status: number, message: string) {
  return createError({ status, message })
}

function formatIssueLines(issues: readonly SpecIssue[]): string {
  return issues
    .slice(0, MCP_DOCUMENT_MAX_REPORTED_ISSUES)
    .map((issue) => {
      return `${issue.path}: ${issue.message}`
    })
    .join('\n')
}

function describeFormats(): string {
  return DOCUMENT_FORMATS.map(format => DOCUMENT_FORMAT_LABELS[format])
    .join(', ')
}

/**
 * The tool description: what the tool does and costs, the limits, and the
 * spec shape, with one compact example per format. The format rules and
 * examples are the ones the chat tool gives its model, so both channels
 * accept the same spec. Written for an external agent: it names `list_files`
 * for image ids and tells the client to declare AI-written content.
 */
export function buildMcpDocumentDescription(): string {
  return [
    `Create a ${describeFormats()} document from a structured spec and save`,
    'it as a private file in your Besidka library. Besidka renders the file',
    'itself: no API key of yours is used and nothing is sent to an AI',
    'provider. The file counts against your storage quota and expires like',
    'an upload. Find it later with list_files (source assistant).',
    'Limits: the serialized spec is at most',
    `${MCP_DOCUMENT_SPEC_MAX_CHARS} characters, a pdf or docx at most 200`,
    'pages, a pptx at most 60 slides, an xlsx at most 100000 cells and the',
    `file at most ${DOCUMENT_MAX_FILE_BYTES / BYTES_PER_MEBIBYTE} MB, at most`,
    `${MCP_DOCUMENT_RENDER_MINUTE_LIMIT.max} documents a minute and`,
    `${MCP_DOCUMENT_RENDER_DAILY_LIMIT.max} a day. Images only by the`,
    '`fileId` of a PNG or JPEG file already in your library (find ids with',
    'list_files), at most 20, never URLs or data URIs. If you wrote the',
    'content with an AI model, set `aiGenerated` to true so the file is',
    'marked as AI-generated; otherwise it is marked only as created by a',
    'connected app. Pass `spec` as a JSON object, not a string: the',
    '`format` and `title` fields are filled from the top-level arguments,',
    'and `specVersion` defaults to 1. A request is at most 512 KiB, so',
    'Cyrillic text fits the whole character limit while CJK text above',
    'about 170000 characters does not. Text is plain: no HTML or Markdown',
    'inside it, no control characters; use runs for bold, italic,',
    'underline, code and links (https: or mailto: only). Write in the',
    'language of the content and set `language` as a BCP 47 tag such as',
    '"en" or "uk". Optional `theme`: {"font"?:"sans"|"serif","accent"?:',
    '"neutral"|"blue"|"green"|"orange"|"violet"}; both fields are optional',
    'and a missing one falls back to "sans" or "neutral".',
    BLOCKS_DESCRIPTION,
    ...DOCUMENT_FORMATS.map(format => FORMAT_RULES[format]),
    'Examples of the full document (spec is the object without format and',
    'title):',
    ...DOCUMENT_FORMATS.map(format => `${format}: ${FORMAT_EXAMPLES[format]}`),
    'On an invalid spec the error lists up to 10 `path: message` lines;',
    'fix them and call again. Requires signing in (files:write).',
  ].join(' ')
}

/**
 * Checks the caller's document flags without a request: `documents`,
 * `documents.mcp` and the flag of the requested format. Each must be on for
 * the user and, as for the routes that create something, the user's own
 * Labs toggle must not be off. Any failure is the same generic 404 raised
 * before the spec is looked at, so the tool never says which flag is off.
 */
export async function assertMcpDocumentsAvailable(
  context: Pick<McpDocumentContext, 'db' | 'kv' | 'userId' | 'logger'>,
  format: DocumentFormat,
): Promise<void> {
  const [rules, userState] = await Promise.all([
    loadFeatureRules(context.kv as KVNamespace, context.db, context.logger),
    loadUserFeatureState(context.db, context.userId),
  ])
  const evaluation = {
    rules,
    userState,
    config: getFeatureEvaluationConfig(),
  }
  const flags = ['documents', 'documents.mcp', DOCUMENT_FEATURE_KEYS[format]]

  for (const flag of flags) {
    const resolution = await evaluateFeature(flag, evaluation)

    if (!isFeatureActive(flag, resolution, userState)) {
      throw createUnavailableError()
    }
  }
}

function formatRetryWait(retryAfter: number | null): string {
  if (retryAfter === null) {
    return 'a while'
  }

  if (retryAfter < SECONDS_PER_MINUTE) {
    return `${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}`
  }

  if (retryAfter < SECONDS_PER_HOUR) {
    return `${Math.ceil(retryAfter / SECONDS_PER_MINUTE)} minutes`
  }

  return `${Math.ceil(retryAfter / SECONDS_PER_HOUR)} hours`
}

async function consumeAllowance(
  kv: DocumentKv,
  userId: number,
  keyPrefix: string,
  rule: { window: number, max: number },
  limitMessage: string,
): Promise<void> {
  const limiter = createAuthRateLimitStorage(kv as KVNamespace, keyPrefix)
  let result: Awaited<ReturnType<typeof limiter.consume>>

  try {
    result = await limiter.consume(String(userId), rule)
  } catch {
    throw createError({
      status: 429,
      message: 'Document requests came too close together. Try again in '
        + `${formatRetryWait(LIMIT_BUSY_RETRY_AFTER_SECONDS)}.`,
      data: { retryAfter: LIMIT_BUSY_RETRY_AFTER_SECONDS },
    })
  }

  if (!result.allowed) {
    throw createError({
      status: 429,
      message: `${limitMessage} Try again in about `
        + `${formatRetryWait(result.retryAfter)}.`,
      data: { retryAfter: result.retryAfter },
    })
  }
}

/**
 * Per-user render budget on top of the MCP write limit: 10 a minute and 100
 * a day. A rejected call renders nothing and leaves no row. The minute bucket
 * is consumed first, so a call refused by it does not spend the daily budget.
 */
export async function consumeDocumentAllowance(
  context: Pick<McpDocumentContext, 'kv' | 'userId'>,
): Promise<void> {
  await consumeAllowance(
    context.kv,
    context.userId,
    DOCUMENT_MINUTE_LIMIT_KEY_PREFIX,
    MCP_DOCUMENT_RENDER_MINUTE_LIMIT,
    'Connected apps can create at most '
    + `${MCP_DOCUMENT_RENDER_MINUTE_LIMIT.max} documents a minute.`,
  )
  await consumeAllowance(
    context.kv,
    context.userId,
    DOCUMENT_DAILY_LIMIT_KEY_PREFIX,
    MCP_DOCUMENT_RENDER_DAILY_LIMIT,
    'Connected apps can create at most '
    + `${MCP_DOCUMENT_RENDER_DAILY_LIMIT.max} documents a day.`,
  )
}

function parseSpecOrThrow(
  input: CreateMcpDocumentInput,
): DocumentSpec {
  const checked = checkDocumentSpecInput(
    { ...input.spec, format: input.format, title: input.title },
    [input.format],
  )

  if (checked.ok) {
    return checked.spec
  }

  const lines = checked.issues && checked.issues.length > 0
    ? formatIssueLines(checked.issues)
    : checked.message

  throw createRejectedError(
    422,
    `Invalid document spec. No document was created. Fix these and call `
    + `create_document again:\n${lines}`,
  )
}

function describeRenderFailure(
  code: string,
  detail: string | undefined,
  issues: readonly SpecIssue[] | undefined,
): { status: number, message: string } {
  const issueLines = issues && issues.length > 0
    ? `\n${formatIssueLines(issues)}`
    : ''
  const suffix = detail ? ` ${detail}.` : ''

  switch (code) {
    case 'spec_invalid':
      return {
        status: 422,
        message: 'The spec was rejected. No document was created. Fix it and '
          + `call create_document again.${suffix}${issueLines}`,
      }
    case 'bounds_exceeded':
      return {
        status: 422,
        message: 'The document is over a size limit (200 pages, 60 slides, '
          + '100000 cells, 20 images, 20 MB). No document was created. '
          + `Make it smaller.${suffix}${issueLines}`,
      }
    case 'asset_invalid':
      return {
        status: 422,
        message: 'An image of the document is unusable. Use only the ids of '
          + 'PNG or JPEG files in your library that are at most 5 MB each '
          + '(20 MB in total). No document was created.',
      }
    case 'spec_version_unsupported':
      return {
        status: 422,
        message: 'The renderer does not support this specVersion. Use '
          + `specVersion 1 or leave it out.${suffix}`,
      }
    default:
      return {
        status: 422,
        message: 'The document could not be rendered from this spec. '
          + 'Simplify it (fewer blocks, smaller tables) and try again. No '
          + 'document was created.',
      }
  }
}

function readErrorField(exception: unknown, field: string): unknown {
  if (typeof exception !== 'object' || exception === null) {
    return undefined
  }

  return (exception as Record<string, unknown>)[field]
}

function isQuotaFailure(exception: unknown): boolean {
  return readErrorField(exception, 'code')
    === DOCUMENT_ERROR_CODES.quotaExceeded
}

function isRendererUnavailable(exception: unknown): boolean {
  return readErrorField(exception, 'status') === 503
}

async function createQuotaError(userId: number) {
  const [policy, usedBytes] = await Promise.all([
    getEffectiveUserFilePolicy(userId),
    getUserStorageUsageBytes(userId),
  ])

  return createRejectedError(
    413,
    'Storage is full, so this document was not created: '
    + `${formatFileSize(usedBytes)} of `
    + `${formatFileSize(policy.maxStorageBytes)} used. Free space on the `
    + 'Storage page in Besidka and try again. No document was created.',
  )
}

async function discardFailedDocument(
  context: McpDocumentContext,
  claimed: DocumentRow,
  errorCode: string,
): Promise<void> {
  try {
    await failClaimedDocument(context.db, claimed, errorCode)
  } catch (exception) {
    setDocumentLog(context.logger, {
      releaseError: exceptionMessage(exception),
    })

    return
  }

  if (claimed.specR2Key === null) {
    return
  }

  try {
    await deleteDocumentSpecObjects([claimed.specR2Key])
    await context.db.update(schema.documents)
      .set({ specR2Key: null, specBytes: null })
      .where(and(
        eq(schema.documents.id, claimed.id),
        eq(schema.documents.userId, context.userId),
      ))
  } catch (exception) {
    setDocumentLog(context.logger, {
      cleanupError: exceptionMessage(exception),
    })
  }
}

async function abandonUnclaimedDocument(
  context: McpDocumentContext,
  row: DocumentRow,
): Promise<void> {
  try {
    if (row.specR2Key !== null) {
      await deleteDocumentSpecObjects([row.specR2Key])
    }

    await context.db.delete(schema.documents)
      .where(and(
        eq(schema.documents.id, row.id),
        eq(schema.documents.userId, context.userId),
      ))
  } catch (exception) {
    setDocumentLog(context.logger, {
      cleanupError: exceptionMessage(exception),
    })
  }
}

async function claimDocumentOrAbandon(
  context: McpDocumentContext,
  row: DocumentRow,
): Promise<DocumentRow> {
  let claimed: DocumentRow | null

  try {
    claimed = await claimDocumentRender(context.db, {
      userId: context.userId,
      documentId: row.id,
    })
  } catch (exception) {
    await abandonUnclaimedDocument(context, row)

    throw exception
  }

  if (claimed) {
    return claimed
  }

  await abandonUnclaimedDocument(context, row)

  throw createRejectedError(
    409,
    'The document could not be started. Try again.',
  )
}

async function assertOwnedImages(
  context: McpDocumentContext,
  spec: DocumentSpec,
): Promise<void> {
  const imageIds = collectImageIds(spec)

  if (imageIds.length === 0) {
    return
  }

  const resolved = await resolveOwnedImageFiles(
    context.db,
    context.userId,
    imageIds,
  )

  if (resolved.missingIds.length === 0) {
    return
  }

  throw createRejectedError(
    422,
    `Unknown image fileId: ${resolved.missingIds.join(', ')}. No document `
    + 'was created. Use only ids of PNG or JPEG image files in your own '
    + 'library (find them with list_files), or leave the image out.',
  )
}

function resolveRequestedFileName(
  fileName: string | undefined,
  format: DocumentFormat,
): string | null {
  if (!fileName) {
    return null
  }

  const extension = `.${format}`
  const stem = fileName.toLowerCase().endsWith(extension)
    ? fileName.slice(0, -extension.length)
    : fileName

  return getDocumentFileName(stem, format)
}

/**
 * Applies the caller's file name and reads the expiry of the stored file.
 * A failed rename never fails the call: the document is already ready, so
 * the generated name stays.
 */
async function finishStoredFile(
  context: McpDocumentContext,
  file: DocumentFileRef,
  requestedName: string | null,
): Promise<{ name: string, expiresAt: string | null }> {
  let name = file.name

  if (requestedName !== null && requestedName !== file.name) {
    try {
      await context.db.update(schema.files)
        .set({ name: requestedName })
        .where(and(
          eq(schema.files.id, file.id),
          eq(schema.files.userId, context.userId),
        ))

      name = requestedName
    } catch (exception) {
      setDocumentLog(context.logger, {
        cleanupError: exceptionMessage(exception),
      })
    }
  }

  let expiresAt: Date | null = null

  try {
    const stored = await context.db.select({
      expiresAt: schema.files.expiresAt,
    })
      .from(schema.files)
      .where(and(
        eq(schema.files.id, file.id),
        eq(schema.files.userId, context.userId),
      ))
      .get()

    expiresAt = stored?.expiresAt ?? null
  } catch (exception) {
    setDocumentLog(context.logger, {
      cleanupError: exceptionMessage(exception),
    })
  }

  return { name, expiresAt: toIsoTimestamp(expiresAt) }
}

type RenderOutcome
  = | {
    ok: false
    failure: { status: number, message: string }
    errorCode: string
  }
  | { ok: true, file: DocumentFileRef, stats: RenderSuccess['stats'] }

async function renderAndStore(
  context: McpDocumentContext,
  claimed: DocumentRow,
  spec: DocumentSpec,
  isAiGenerated: boolean,
): Promise<RenderOutcome> {
  const images = await loadDocumentImageAssets(
    context.db,
    context.userId,
    collectImageIds(spec),
  )

  if (!images.ok) {
    return {
      ok: false,
      failure: describeRenderFailure(images.code, undefined, undefined),
      errorCode: images.code,
    }
  }

  const result = await renderDocument({
    specVersion: spec.specVersion,
    spec,
    assets: images.assets,
    provenance: {
      model: null,
      createdVia: 'mcp',
      aiGenerated: isAiGenerated,
    },
  }, context.logger)

  if (!result.ok) {
    return {
      ok: false,
      failure: describeRenderFailure(
        result.code,
        result.detail,
        result.issues,
      ),
      errorCode: result.code,
    }
  }

  const file = await finalizeRenderedDocument({
    db: context.db,
    userId: context.userId,
    row: claimed,
    bytes: result.bytes,
    renderedBy: 'worker',
    logger: context.logger,
  })

  return {
    ok: true,
    file,
    stats: withSpecStats(result.stats, spec),
  }
}

/**
 * Renders a caller-supplied spec into a private file. The document row
 * records `createdVia: 'mcp'` and no model, and the file is marked as
 * created by a connected app, as AI-generated only when the caller says so.
 * The synchronous render runs inside the tool call: the row is claimed
 * (`rendering` with a lease), the spec object is written to R2, and on any
 * failure the row becomes `failed` with an error code, the spec object is
 * deleted and no row is left `rendering`. Images are read one R2 object at a
 * time. Failures a caller can fix are 4xx errors with a readable message; a
 * renderer outage stays a generic server error.
 */
export async function createMcpDocument(
  context: McpDocumentContext,
  input: CreateMcpDocumentInput,
) {
  await assertMcpDocumentsAvailable(context, input.format)

  if (JSON.stringify(input.spec).length > MCP_DOCUMENT_SPEC_MAX_CHARS) {
    throw createRejectedError(
      400,
      `The spec is longer than ${MCP_DOCUMENT_SPEC_MAX_CHARS} characters `
      + 'when serialized. Shorten the content or split it into several '
      + 'documents.',
    )
  }

  const spec = parseSpecOrThrow(input)

  await assertOwnedImages(context, spec)
  await consumeDocumentAllowance(context)

  const row = await createDocument(context.db, {
    userId: context.userId,
    format: spec.format,
    title: spec.title,
    createdVia: 'mcp',
    aiGenerated: input.aiGenerated === true,
    specVersion: spec.specVersion,
    stats: toDocumentStats(spec),
    specJson: JSON.stringify(spec),
  })
  const claimed = await claimDocumentOrAbandon(context, row)

  let outcome: RenderOutcome

  try {
    outcome = await renderAndStore(
      context,
      claimed,
      spec,
      input.aiGenerated === true,
    )
  } catch (exception) {
    const isQuota = isQuotaFailure(exception)
    const errorCode = isQuota
      ? DOCUMENT_ERROR_CODES.quotaExceeded
      : isRendererUnavailable(exception)
        ? DOCUMENT_ERROR_CODES.rendererUnavailable
        : DOCUMENT_ERROR_CODES.renderFailed

    await discardFailedDocument(context, claimed, errorCode)

    if (isQuota) {
      throw await createQuotaError(context.userId)
    }

    throw exception
  }

  if (!outcome.ok) {
    await discardFailedDocument(context, claimed, outcome.errorCode)

    throw createRejectedError(outcome.failure.status, outcome.failure.message)
  }

  const stored = await finishStoredFile(
    context,
    outcome.file,
    resolveRequestedFileName(input.fileName, spec.format),
  )

  return {
    documentId: claimed.id,
    file: {
      id: outcome.file.id,
      name: stored.name,
      size: outcome.file.size,
      type: outcome.file.type,
      expiresAt: stored.expiresAt,
    },
    format: spec.format,
    stats: outcome.stats,
  }
}
