import {
  checkSpecBounds,
  formatIssuePath,
  measureSerializedLength,
} from './bounds.ts'
import type { SpecIssue } from './bounds.ts'
import {
  documentSpecSchema,
  resolveThemeFields,
  SPEC_LIMITS,
} from './v1.ts'
import type { DocumentSpec } from './v1.ts'

export const DOCUMENT_SPEC_VERSION = 1
export const SUPPORTED_SPEC_VERSIONS: readonly number[] = [1]
export const MAX_REPORTED_ISSUES = 10

export {
  checkSpecBounds,
  collectImageIds,
  countCells,
  countImages,
  estimatePages,
} from './bounds.ts'
export type { SpecIssue } from './bounds.ts'
export { summarizeSpec } from './summarize.ts'
export type { SpecSummary } from './summarize.ts'
export {
  blockSchema,
  documentSpecSchema,
  HYPERLINK_PROTOCOLS,
  DEFAULT_THEME,
  isAllowedHyperlink,
  resolveThemeFields,
  SPEC_LIMITS,
} from './v1.ts'
export type {
  Block,
  Cell,
  CodeBlock,
  DocumentFormat,
  DocumentSpec,
  DocxSpec,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  ListItem,
  ParagraphBlock,
  PdfSpec,
  PptxSpec,
  QuoteBlock,
  Run,
  Sheet,
  Slide,
  TableBlock,
  ResolvedTheme,
  Theme,
  XlsxSpec,
} from './v1.ts'

export type ParseDocumentSpecResult
  = | { ok: true, spec: DocumentSpec }
    | { ok: false, issues: SpecIssue[] }

function readField(input: unknown, field: string): unknown {
  if (typeof input === 'object' && input !== null && field in input) {
    return (input as Record<string, unknown>)[field]
  }

  return undefined
}

/**
 * Validates untrusted model or MCP input. The result lists at most the first
 * ten issues with JSON paths such as `$.blocks[3].runs[0].link.href`, so a
 * caller can feed them back to the model for self-correction.
 */
export function parseDocumentSpec(input: unknown): ParseDocumentSpecResult {
  const serializedLength = measureSerializedLength(input)

  if (serializedLength === null) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'Spec must be JSON-serializable' }],
    }
  }

  const serializedLimit = readField(input, 'format') === 'xlsx'
    ? SPEC_LIMITS.serializedMaxWorkbook
    : SPEC_LIMITS.serializedMax

  if (serializedLength > serializedLimit) {
    return {
      ok: false,
      issues: [{
        path: '$',
        message: `Spec is ${serializedLength} characters, limit ${serializedLimit}`,
      }],
    }
  }

  const version = readField(input, 'specVersion')

  if (
    version !== undefined
    && !SUPPORTED_SPEC_VERSIONS.includes(version as number)
  ) {
    return {
      ok: false,
      issues: [{
        path: '$.specVersion',
        message: `Unsupported specVersion, supported: ${SUPPORTED_SPEC_VERSIONS.join(', ')}`,
      }],
    }
  }

  const result = documentSpecSchema.safeParse(input)

  if (!result.success) {
    const issues = result.error.issues
      .slice(0, MAX_REPORTED_ISSUES)
      .map((issue) => {
        return { path: formatIssuePath(issue.path), message: issue.message }
      })

    return { ok: false, issues }
  }

  const boundIssues = checkSpecBounds(result.data)

  if (boundIssues.length > 0) {
    return { ok: false, issues: boundIssues.slice(0, MAX_REPORTED_ISSUES) }
  }

  const spec: DocumentSpec = result.data.theme
    ? { ...result.data, theme: resolveThemeFields(result.data.theme) }
    : result.data

  return { ok: true, spec }
}
