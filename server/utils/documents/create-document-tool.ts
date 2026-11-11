import type { ToolSet } from 'ai'
import { jsonSchema, tool, zodSchema } from 'ai'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  collectImageIds,
  documentSpecSchema,
  parseDocumentSpec,
  summarizeSpec,
} from '@besidka/doc-renderer/spec'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import {
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_LABELS,
  DOCUMENT_MAX_CALLS_PER_TURN,
  DOCUMENT_TOOL_NAME,
} from '#shared/utils/documents'
import type {
  DocumentFormat,
  DocumentStats,
  DocumentToolOutput,
} from '#shared/utils/documents'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { resolveOwnedImageFiles } from '~~/server/utils/documents/images'
import { createDocument } from '~~/server/utils/documents/store'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export const DOCUMENT_TOOL_ERROR_CODES = {
  invalidInput: 'document-invalid-input',
  formatDisabled: 'document-format-disabled',
  turnLimit: 'document-turn-limit',
  unknownImage: 'document-unknown-image',
  writeFailed: 'document-write-failed',
} as const

export const DOCUMENT_TOOL_DESCRIPTION_MAX_CHARACTERS = 5500

export interface CreateDocumentToolInput {
  userId: number
  chatId: string
  db: DbClient
  logger: LoggerLike
  enabledFormats: readonly DocumentFormat[]
  modelId?: string | null
  provider?: string | null
  assistantMessageId: string
}

type DocumentSpecCheck
  = | { ok: true, spec: DocumentSpec }
    | { ok: false, code: string, message: string }

type SpecOption = (typeof documentSpecSchema.options)[number]

const FORMAT_EXAMPLES: Record<DocumentFormat, string> = {
  pdf: '{"specVersion":1,"format":"pdf","title":"Trip plan","language":"en",'
    + '"pageSize":"A4","blocks":[{"type":"heading","level":1,"text":"Trip '
    + 'plan"},{"type":"paragraph","runs":[{"text":"Leave on "},{"text":'
    + '"Friday","bold":true}]}]}',
  docx: '{"specVersion":1,"format":"docx","title":"Cover letter","blocks":'
    + '[{"type":"paragraph","runs":[{"text":"Dear team,"}]},{"type":"list",'
    + '"ordered":false,"items":[{"runs":[{"text":"Experience"}]}]}]}',
  pptx: '{"specVersion":1,"format":"pptx","title":"Q3 review","aspect":'
    + '"16:9","slides":[{"layout":"title","title":"Q3 review","subtitle":'
    + '"Sales"},{"layout":"title-content","title":"Highlights","bullets":'
    + '[[{"text":"Revenue up 12%"}]],"notes":"Thank the team"}]}',
  xlsx: '{"specVersion":1,"format":"xlsx","title":"Budget","sheets":[{"name":'
    + '"Budget","freezeHeader":true,"columns":[{"header":"Item","type":'
    + '"string"},{"header":"Cost","type":"currency"}],"rows":[["Rent",1200],'
    + '["Food",400],["Total",{"formula":"SUM(B2:B3)"}]]}]}',
}

const FORMAT_RULES: Record<DocumentFormat, string> = {
  pdf: 'pdf needs pageSize "A4" or "Letter" and blocks.',
  docx: 'docx needs blocks.',
  pptx: 'pptx needs aspect "16:9" or "4:3" and slides. Slide layouts: '
    + 'title, title-content, section, two-column (needs columns: two block '
    + 'arrays) and image (needs image {fileId, alt}); at most 12 bullets '
    + '(each a runs array) per slide, 60 slides, optional notes.',
  xlsx: 'xlsx needs sheets {name, columns:[{header, type}], rows}. Column '
    + 'types: string, number, integer, currency, percent, date, boolean. A '
    + 'cell is a string, number, boolean, null, {"date":"2026-11-08"} or '
    + '{"formula":"SUM(B2:B9)"}: A1 references to the sheet itself (row 1 '
    + 'is the header), plain functions such as SUM, AVERAGE, MIN, MAX, '
    + 'COUNT, ROUND, IF, VLOOKUP, no external references. A row may be '
    + 'shorter than the columns. Sheet names: at most 31 characters, '
    + 'unique, none of [ ] : * ? / \\, not "History".',
}

const BLOCKS_DESCRIPTION = 'Blocks for pdf and docx: {"type":"heading",'
  + '"level":1-4,"text"}, {"type":"paragraph","runs":[...],"align?"}, '
  + '{"type":"list","ordered":bool,"items":[{"runs":[...],"children?":'
  + '[...]}]} (three levels at most), {"type":"table","header":bool,'
  + '"columns":[{"text","align?"}],"rows":[[runs,...]]} (every row has one '
  + 'runs array per column), {"type":"image","fileId","alt","widthPercent":'
  + '10-100}, {"type":"quote","runs"}, {"type":"code","text","language?"}, '
  + '{"type":"pageBreak"}. A run is {"text","bold?","italic?","underline?",'
  + '"code?","link?":{"href"}}.'

const BLOCK_FORMATS: readonly DocumentFormat[] = ['pdf', 'docx']

function createToolError(code: string, message: string) {
  return createError({
    message,
    status: 400,
    code,
    why: message,
  })
}

function formatEnabledFormats(formats: readonly DocumentFormat[]): string {
  return formats.map(format => DOCUMENT_FORMAT_LABELS[format]).join(', ')
}

function describeSpecIssues(
  issues: readonly { path: string, message: string }[],
): string {
  return issues.map((issue) => {
    return `${issue.path}: ${issue.message}`
  }).join('; ')
}

function readFormat(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  return (value as Record<string, unknown>).format
}

/**
 * The tool description for the formats the user may create. It carries the
 * rules the model most often breaks and one compact example per enabled
 * format, and stays well under the 1,500 token budget of the ticket.
 */
export function buildDocumentToolDescription(
  enabledFormats: readonly DocumentFormat[],
): string {
  const formats = DOCUMENT_FORMATS.filter((format) => {
    return enabledFormats.includes(format)
  })
  const hasBlockFormat = formats.some(format => BLOCK_FORMATS.includes(format))

  return [
    `Create a downloadable document (${formatEnabledFormats(formats)}) from`,
    'a structured spec. Use it only when the user asks for a file such as a',
    'report, letter, CV, deck, spreadsheet or PDF; answer everything else',
    'in the reply. The user sees a document card under your reply and',
    'downloads the file from it, so never paste links, file ids or the',
    'content again: add one or two sentences. Call it at most',
    `${DOCUMENT_MAX_CALLS_PER_TURN} times per reply.`,
    'Keep it concise: only what was asked, no filler. Write in the user\'s',
    'language (Cyrillic and Latin both work) and set `language` as a BCP 47',
    'tag such as "en" or "uk". Every spec has specVersion 1, format and a',
    'title of at most 200 characters. Text is plain: no HTML or Markdown',
    'inside it, no control characters; use runs for bold, italic,',
    'underline, code and links. Links are https: or mailto: only. Images',
    'only by the `fileId` of a PNG or JPEG file the user attached or that',
    'was generated in this chat, at most 20; never URLs or data URIs.',
    'Optional `theme`: {"font":"sans"|"serif","accent":"neutral"|"blue"|'
    + '"green"|"orange"|"violet"}.',
    hasBlockFormat ? BLOCKS_DESCRIPTION : '',
    ...formats.map(format => FORMAT_RULES[format]),
    'Examples:',
    ...formats.map(format => `${format}: ${FORMAT_EXAMPLES[format]}`),
  ].filter(Boolean).join(' ')
}

/**
 * The input schema for the enabled formats: the spec union filtered by its
 * `format` discriminator, so the model never sees a format it cannot create.
 */
export function buildDocumentToolSpecSchema(
  enabledFormats: readonly DocumentFormat[],
): z.ZodType<DocumentSpec> {
  const options = documentSpecSchema.options.filter((option: SpecOption) => {
    return enabledFormats.includes(option.shape.format.value)
  })

  if (options.length === documentSpecSchema.options.length) {
    return documentSpecSchema
  }

  return z.discriminatedUnion(
    'format',
    options as [SpecOption, ...SpecOption[]],
  ) as unknown as z.ZodType<DocumentSpec>
}

/**
 * Validates a model-written spec against the enabled formats and the spec
 * bounds. The message lists JSON paths and rule messages only, never the
 * document text, so it is safe to return to the model and to log.
 */
export function checkDocumentSpecInput(
  input: unknown,
  enabledFormats: readonly DocumentFormat[],
): DocumentSpecCheck {
  const requestedFormat = readFormat(input)
  const isDisabledFormat = typeof requestedFormat === 'string'
    && (DOCUMENT_FORMATS as readonly string[]).includes(requestedFormat)
    && !enabledFormats.includes(requestedFormat as DocumentFormat)

  if (isDisabledFormat) {
    return {
      ok: false,
      code: DOCUMENT_TOOL_ERROR_CODES.formatDisabled,
      message: `The ${requestedFormat} format is not available. No document `
        + `was created. Use one of: ${enabledFormats.join(', ')}, or tell the `
        + 'user this format is unavailable.',
    }
  }

  const parsed = parseDocumentSpec(input)

  if (parsed.ok) {
    return { ok: true, spec: parsed.spec }
  }

  return {
    ok: false,
    code: DOCUMENT_TOOL_ERROR_CODES.invalidInput,
    message: `Invalid document spec. ${describeSpecIssues(parsed.issues)}. `
      + 'No document was created. Fix these fields and call '
      + `\`${DOCUMENT_TOOL_NAME}\` again, or tell the user it could not be `
      + 'created.',
  }
}

function toDocumentStats(spec: DocumentSpec): DocumentStats {
  const summary = summarizeSpec(spec)

  return {
    pages: summary.pages,
    slides: summary.slides,
    sheets: summary.sheets,
    cells: summary.cells,
    images: summary.images,
  }
}

/**
 * Builds the `create_document` chat tool. The tool stores the spec (R2 plus
 * a `documents` row) and returns the document id and stats; the browser
 * renders the file afterwards. At most `DOCUMENT_MAX_CALLS_PER_TURN` calls
 * count per send: the counter is taken before the first `await`, so calls
 * that run in parallel cannot exceed it. Images must be PNG or JPEG files of
 * the user. Errors are thrown as tool errors with a message the model can
 * act on.
 */
export function createDocumentTool(input: CreateDocumentToolInput): ToolSet {
  const enabledFormats = DOCUMENT_FORMATS.filter((format) => {
    return input.enabledFormats.includes(format)
  })
  let calls = 0
  let created = 0
  let rejected = 0

  function logCounts(extra: Record<string, unknown> = {}): void {
    input.logger.set({
      attributes: {
        documents: { tool: { calls, created, rejected, ...extra } },
      },
    })
  }

  function reject(code: string, message: string): never {
    rejected += 1
    logCounts({ lastError: code })

    throw createToolError(code, message)
  }

  const specSchema = buildDocumentToolSpecSchema(enabledFormats)

  return {
    [DOCUMENT_TOOL_NAME]: withFollowUpTurn(tool({
      description: buildDocumentToolDescription(enabledFormats),
      inputSchema: jsonSchema<DocumentSpec>(
        zodSchema(specSchema).jsonSchema,
        {
          validate(value) {
            const checked = checkDocumentSpecInput(value, enabledFormats)

            if (checked.ok) {
              return { success: true, value: checked.spec }
            }

            rejected += 1
            logCounts({ lastError: checked.code })

            return { success: false, error: new Error(checked.message) }
          },
        },
      ),
      async execute(spec) {
        if (calls >= DOCUMENT_MAX_CALLS_PER_TURN) {
          reject(
            DOCUMENT_TOOL_ERROR_CODES.turnLimit,
            `At most ${DOCUMENT_MAX_CALLS_PER_TURN} documents can be created `
            + 'in one reply. Finish the reply and let the user ask for more.',
          )
        }

        calls += 1

        const checked = checkDocumentSpecInput(spec, enabledFormats)

        if (!checked.ok) {
          reject(checked.code, checked.message)
        }

        const validSpec = checked.spec
        const imageIds = collectImageIds(validSpec)

        if (imageIds.length > 0) {
          const resolved = await resolveOwnedImageFiles(
            input.db,
            input.userId,
            imageIds,
          )

          if (resolved.missingIds.length > 0) {
            reject(
              DOCUMENT_TOOL_ERROR_CODES.unknownImage,
              `Unknown image fileId: ${resolved.missingIds.join(', ')}. No `
              + 'document was created. Use only ids of PNG or JPEG files '
              + 'the user attached or that were generated in this chat, or '
              + 'leave the image out.',
            )
          }
        }

        const stats = toDocumentStats(validSpec)

        try {
          const row = await createDocument(input.db, {
            userId: input.userId,
            format: validSpec.format,
            title: validSpec.title,
            createdVia: 'chat',
            originChatId: input.chatId,
            originMessagePublicId: input.assistantMessageId,
            originProvider: input.provider ?? null,
            originModel: input.modelId ?? null,
            specVersion: validSpec.specVersion,
            stats,
            specJson: JSON.stringify(validSpec),
          })

          created += 1
          logCounts({ format: validSpec.format })

          return {
            documentId: row.id,
            format: validSpec.format,
            title: validSpec.title,
            specVersion: validSpec.specVersion,
            stats,
          } satisfies DocumentToolOutput
        } catch (exception) {
          rejected += 1
          logCounts({
            lastError: DOCUMENT_TOOL_ERROR_CODES.writeFailed,
            writeError: exceptionMessage(exception),
          })

          throw createToolError(
            DOCUMENT_TOOL_ERROR_CODES.writeFailed,
            'The document could not be saved. Tell the user to try again '
            + 'later.',
          )
        }
      },
    })),
  }
}
