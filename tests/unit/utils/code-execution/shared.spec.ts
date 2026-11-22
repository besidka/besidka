import { describe, expect, it } from 'vitest'
import {
  CODE_EXECUTION_TRUNCATION_MARKER,
  getCodeExecutionSkipReasonText,
  isCodeExecutionProvider,
  isDataCodeExecutionFilesPart,
  readCodeExecutionView,
  truncateUtf8,
} from '#shared/utils/code-execution'

describe('truncateUtf8', () => {
  it('leaves short text alone', () => {
    expect(truncateUtf8('hello', 100)).toEqual({
      text: 'hello',
      truncated: false,
    })
  })

  it('cuts to the byte budget including the marker', () => {
    const result = truncateUtf8('a'.repeat(500), 100)

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith(CODE_EXECUTION_TRUNCATION_MARKER)).toBe(true)
    const size = new TextEncoder().encode(result.text).byteLength

    expect(size).toBeLessThanOrEqual(100)
  })

  it('never splits a surrogate pair', () => {
    const result = truncateUtf8('😀'.repeat(100), 50)

    expect(result.text.replace(CODE_EXECUTION_TRUNCATION_MARKER, ''))
      .toMatch(/^(?:😀)*$/u)
  })
})

describe('readCodeExecutionView', () => {
  it('reads a finished run', () => {
    expect(readCodeExecutionView({
      type: 'tool-code_execution',
      state: 'output-available',
      input: { language: 'bash', code: 'ls', codeTruncated: true },
      output: { stdout: 'a', stderr: 'b', returnCode: 1 },
    } as never)).toMatchObject({
      state: 'done',
      language: 'bash',
      code: 'ls',
      codeTruncated: true,
      stdout: 'a',
      stderr: 'b',
      returnCode: 1,
    })
  })

  it('reads a running and a failed run', () => {
    expect(readCodeExecutionView({
      type: 'tool-code_execution',
      state: 'input-streaming',
    } as never)?.state).toBe('running')
    expect(readCodeExecutionView({
      type: 'tool-code_execution',
      state: 'output-error',
      errorText: 'nope',
    } as never)).toMatchObject({ state: 'error', errorText: 'nope' })
  })

  it('ignores other parts', () => {
    expect(readCodeExecutionView({ type: 'text', text: 'x' } as never))
      .toBeNull()
  })
})

describe('code execution helpers', () => {
  it('knows the three providers with a sandbox', () => {
    expect(isCodeExecutionProvider('anthropic')).toBe(true)
    expect(isCodeExecutionProvider('openai')).toBe(true)
    expect(isCodeExecutionProvider('google')).toBe(true)
    expect(isCodeExecutionProvider('deepseek')).toBe(false)
    expect(isCodeExecutionProvider('moonshotai')).toBe(false)
    expect(isCodeExecutionProvider('qwen')).toBe(false)
  })

  it('words every skip reason as "file not saved"', () => {
    for (const reason of [
      'type-not-allowed',
      'too-large',
      'limit-reached',
      'download-failed',
      'validation-failed',
      'storage-failed',
    ] as const) {
      expect(getCodeExecutionSkipReasonText(reason))
        .toMatch(/^file not saved: /)
    }
  })

  it('validates the skipped-files data part', () => {
    expect(isDataCodeExecutionFilesPart({
      type: 'data-code-execution-files',
      data: { savedCount: 0, skipped: [{ filename: 'a', reason: 'x' }] },
    })).toBe(true)
    expect(isDataCodeExecutionFilesPart({
      type: 'data-code-execution-files',
      data: { skipped: 'no' },
    })).toBe(false)
  })
})
