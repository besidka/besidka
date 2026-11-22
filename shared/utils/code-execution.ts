import type { UIMessage } from 'ai'

export const CODE_EXECUTION_TOOL_NAME = 'code_execution'
export const CODE_EXECUTION_PART_TYPE = 'tool-code_execution'
export const CODE_EXECUTION_FILES_PART_TYPE = 'data-code-execution-files'

export const CODE_EXECUTION_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
] as const

export const CODE_EXECUTION_CODE_MAX_BYTES = 32 * 1024
export const CODE_EXECUTION_STREAM_MAX_BYTES = 32 * 1024
export const CODE_EXECUTION_MAX_OUTPUT_FILES = 10
export const CODE_EXECUTION_MAX_FILE_BYTES = 20 * 1024 * 1024
export const CODE_EXECUTION_MAX_INPUT_FILES = 10
export const CODE_EXECUTION_MAX_INPUT_BYTES = 20 * 1024 * 1024

export const CODE_EXECUTION_TRUNCATION_MARKER = '\n[truncated]'

export type CodeExecutionProvider = typeof CODE_EXECUTION_PROVIDERS[number]

export type CodeExecutionLanguage = 'python' | 'bash' | 'text'

export type CodeExecutionSkipReason
  = | 'type-not-allowed'
    | 'too-large'
    | 'limit-reached'
    | 'download-failed'
    | 'validation-failed'
    | 'storage-failed'

export interface CodeExecutionSkippedFile {
  filename: string
  reason: CodeExecutionSkipReason
}

export interface CodeExecutionToolInput {
  language: CodeExecutionLanguage
  code: string
  codeTruncated?: boolean
}

export interface CodeExecutionToolOutput {
  stdout: string
  stderr: string
  returnCode: number | null
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

export interface DataCodeExecutionFilesPart {
  type: typeof CODE_EXECUTION_FILES_PART_TYPE
  data: {
    savedCount: number
    skipped: CodeExecutionSkippedFile[]
  }
}

export interface CodeExecutionView {
  state: 'running' | 'done' | 'error'
  language: CodeExecutionLanguage
  code: string
  codeTruncated: boolean
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  returnCode: number | null
  errorText: string | null
}

const SKIP_REASON_TEXT: Record<CodeExecutionSkipReason, string> = {
  'type-not-allowed': 'file not saved: type not allowed',
  'too-large': 'file not saved: larger than 20 MB',
  'limit-reached': 'file not saved: more than 10 files in one reply',
  'download-failed': 'file not saved: download failed',
  'validation-failed': 'file not saved: it did not pass validation',
  'storage-failed': 'file not saved: storage failed',
}

export function getCodeExecutionSkipReasonText(
  reason: CodeExecutionSkipReason,
): string {
  return SKIP_REASON_TEXT[reason] ?? SKIP_REASON_TEXT['download-failed']
}

export function isCodeExecutionProvider(
  value: unknown,
): value is CodeExecutionProvider {
  return (CODE_EXECUTION_PROVIDERS as readonly unknown[]).includes(value)
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xD800 && codeUnit <= 0xDBFF
}

export function truncateUtf8(
  text: string,
  maxBytes: number,
): { text: string, truncated: boolean } {
  const encoder = new TextEncoder()

  if (encoder.encode(text).byteLength <= maxBytes) {
    return { text, truncated: false }
  }

  const budget = maxBytes
    - encoder.encode(CODE_EXECUTION_TRUNCATION_MARKER).byteLength
  let low = 0
  let high = text.length

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)

    if (encoder.encode(text.slice(0, middle)).byteLength <= budget) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  const endsInsidePair = low > 0 && isHighSurrogate(text.charCodeAt(low - 1))
  const kept = text.slice(0, endsInsidePair ? low - 1 : low)

  return {
    text: `${kept}${CODE_EXECUTION_TRUNCATION_MARKER}`,
    truncated: true,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readLanguage(value: unknown): CodeExecutionLanguage {
  return value === 'bash' || value === 'text' ? value : 'python'
}

export function isCodeExecutionToolPart(part: unknown): boolean {
  return readRecord(part)?.type === CODE_EXECUTION_PART_TYPE
}

export function isDataCodeExecutionFilesPart(
  part: unknown,
): part is DataCodeExecutionFilesPart {
  const record = readRecord(part)

  if (record?.type !== CODE_EXECUTION_FILES_PART_TYPE) {
    return false
  }

  const data = readRecord(record.data)

  return typeof data?.savedCount === 'number'
    && Array.isArray(data.skipped)
    && data.skipped.every((entry) => {
      const skipped = readRecord(entry)

      return typeof skipped?.filename === 'string'
        && typeof skipped.reason === 'string'
    })
}

/**
 * Reads a `tool-code_execution` message part, live or persisted, into the
 * flat shape the card renders. The server compacts every part before it
 * reaches the client, so the only unfinished shape here is a streaming one
 * with a partial or missing input.
 */
export function readCodeExecutionView(
  part: UIMessage['parts'][number] | Record<string, unknown>,
): CodeExecutionView | null {
  const record = readRecord(part)

  if (!record || record.type !== CODE_EXECUTION_PART_TYPE) {
    return null
  }

  const input = readRecord(record.input)
  const output = readRecord(record.output)
  const state = record.state
  const isError = state === 'output-error'
  const isDone = state === 'output-available'
  const returnCode = typeof output?.returnCode === 'number'
    ? output.returnCode
    : null

  return {
    state: isError ? 'error' : isDone ? 'done' : 'running',
    language: readLanguage(input?.language),
    code: typeof input?.code === 'string' ? input.code : '',
    codeTruncated: input?.codeTruncated === true,
    stdout: typeof output?.stdout === 'string' ? output.stdout : '',
    stderr: typeof output?.stderr === 'string' ? output.stderr : '',
    stdoutTruncated: output?.stdoutTruncated === true,
    stderrTruncated: output?.stderrTruncated === true,
    returnCode,
    errorText: isError && typeof record.errorText === 'string'
      ? record.errorText
      : null,
  }
}
