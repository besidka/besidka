import type {
  CodeExecutionLanguage,
  CodeExecutionToolInput,
  CodeExecutionToolOutput,
} from '#shared/utils/code-execution'
import {
  CODE_EXECUTION_CODE_MAX_BYTES,
  CODE_EXECUTION_STREAM_MAX_BYTES,
  truncateUtf8,
} from '#shared/utils/code-execution'

export interface CompactedCodeExecutionOutput {
  output: CodeExecutionToolOutput
  errorText?: string
}

const GOOGLE_OK_OUTCOME = 'OUTCOME_OK'
const DEFAULT_ERROR_TEXT = 'The provider could not run the code.'
const ERROR_TEXT_MAX_BYTES = 1024

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readReturnCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readLanguage(value: unknown): CodeExecutionLanguage | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.toLowerCase()

  if (normalized === 'bash' || normalized === 'shell') {
    return 'bash'
  }

  if (normalized === 'python' || normalized === 'language_python') {
    return 'python'
  }

  return normalized === 'text' ? 'text' : null
}

function describeEditorInput(record: Record<string, unknown>): string {
  const command = readString(record.command)
  const path = readString(record.path)
  const header = `${command} ${path}`.trim()
  const body = readString(record.file_text)
    || readString(record.new_str)

  return body ? `${header}\n${body}` : header
}

function buildInput(
  language: CodeExecutionLanguage,
  code: string,
  wasTruncated = false,
): CodeExecutionToolInput {
  const truncated = truncateUtf8(code, CODE_EXECUTION_CODE_MAX_BYTES)

  return {
    language,
    code: truncated.text,
    ...(truncated.truncated || wasTruncated ? { codeTruncated: true } : {}),
  }
}

export function capErrorText(text: string): string {
  return truncateUtf8(text, ERROR_TEXT_MAX_BYTES).text
}

/**
 * Reduces the input of a provider code execution call (Anthropic's
 * programmatic, bash and text-editor calls, OpenAI's `{ code, containerId }`,
 * Gemini's `{ language, code }`, or an already compact input) to a language
 * and the code, capped at 32 KB. Provider container ids are dropped.
 */
export function compactCodeExecutionInput(
  rawInput: unknown,
): CodeExecutionToolInput {
  const record = readRecord(rawInput)

  if (!record) {
    return buildInput('python', '')
  }

  if (record.type === 'bash_code_execution') {
    return buildInput('bash', readString(record.command))
  }

  if (record.type === 'text_editor_code_execution') {
    return buildInput('text', describeEditorInput(record))
  }

  const explicitLanguage = readLanguage(record.language)

  return buildInput(
    explicitLanguage ?? 'python',
    readString(record.code),
    record.codeTruncated === true,
  )
}

function buildOutput(input: {
  stdout: string
  stderr: string
  returnCode: number | null
}): CodeExecutionToolOutput {
  const stdout = truncateUtf8(input.stdout, CODE_EXECUTION_STREAM_MAX_BYTES)
  const stderr = truncateUtf8(input.stderr, CODE_EXECUTION_STREAM_MAX_BYTES)

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    returnCode: input.returnCode,
    ...(stdout.truncated ? { stdoutTruncated: true } : {}),
    ...(stderr.truncated ? { stderrTruncated: true } : {}),
  }
}

function compactEditorResult(
  record: Record<string, unknown>,
): CompactedCodeExecutionOutput | null {
  if (record.type === 'text_editor_code_execution_view_result') {
    return {
      output: buildOutput({
        stdout: readString(record.content),
        stderr: '',
        returnCode: null,
      }),
    }
  }

  if (record.type === 'text_editor_code_execution_create_result') {
    return {
      output: buildOutput({
        stdout: record.is_file_update === true
          ? 'File updated.'
          : 'File created.',
        stderr: '',
        returnCode: null,
      }),
    }
  }

  if (record.type === 'text_editor_code_execution_str_replace_result') {
    const lines = Array.isArray(record.lines) ? record.lines : []

    return {
      output: buildOutput({
        stdout: lines.filter(line => typeof line === 'string').join('\n'),
        stderr: '',
        returnCode: null,
      }),
    }
  }

  return null
}

function compactOpenAiResult(
  record: Record<string, unknown>,
): CompactedCodeExecutionOutput | null {
  if (!Array.isArray(record.outputs) && !('outputs' in record)) {
    return null
  }

  const outputs = Array.isArray(record.outputs) ? record.outputs : []
  const logs = outputs
    .map(readRecord)
    .filter((entry) => {
      return entry?.type === 'logs'
    })
    .map(entry => readString(entry?.logs))
    .join('\n')

  return {
    output: buildOutput({ stdout: logs, stderr: '', returnCode: null }),
  }
}

function compactGoogleResult(
  record: Record<string, unknown>,
): CompactedCodeExecutionOutput | null {
  if (typeof record.outcome !== 'string') {
    return null
  }

  const text = readString(record.output)

  if (record.outcome === GOOGLE_OK_OUTCOME) {
    return {
      output: buildOutput({ stdout: text, stderr: '', returnCode: 0 }),
    }
  }

  return {
    output: buildOutput({ stdout: '', stderr: text, returnCode: 1 }),
  }
}

/**
 * Reduces the result of a provider code execution call to stdout, stderr and
 * the return code, each capped at 32 KB with a truncation marker. Encrypted
 * Anthropic stdout, provider file ids and OpenAI image URLs are dropped. A
 * provider error result becomes `errorText`.
 */
export function compactCodeExecutionOutput(
  rawOutput: unknown,
): CompactedCodeExecutionOutput {
  const record = readRecord(rawOutput)

  if (!record) {
    return {
      output: buildOutput({ stdout: '', stderr: '', returnCode: null }),
    }
  }

  if (
    typeof record.type === 'string'
    && record.type.endsWith('_tool_result_error')
  ) {
    return {
      output: buildOutput({ stdout: '', stderr: '', returnCode: null }),
      errorText: capErrorText(
        readString(record.error_code) || DEFAULT_ERROR_TEXT,
      ),
    }
  }

  const editorResult = compactEditorResult(record)

  if (editorResult) {
    return editorResult
  }

  if (
    record.type === 'code_execution_result'
    || record.type === 'encrypted_code_execution_result'
    || record.type === 'bash_code_execution_result'
  ) {
    return {
      output: buildOutput({
        stdout: readString(record.stdout),
        stderr: readString(record.stderr),
        returnCode: readReturnCode(record.return_code),
      }),
    }
  }

  const googleResult = compactGoogleResult(record)

  if (googleResult) {
    return googleResult
  }

  const openAiResult = compactOpenAiResult(record)

  if (openAiResult) {
    return openAiResult
  }

  const output = buildOutput({
    stdout: readString(record.stdout),
    stderr: readString(record.stderr),
    returnCode: readReturnCode(record.returnCode),
  })

  return {
    output: {
      ...output,
      ...(record.stdoutTruncated === true ? { stdoutTruncated: true } : {}),
      ...(record.stderrTruncated === true ? { stderrTruncated: true } : {}),
    },
  }
}
