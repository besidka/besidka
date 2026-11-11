import { describe, expect, it } from 'vitest'
import {
  CODE_EXECUTION_CODE_MAX_BYTES,
  CODE_EXECUTION_STREAM_MAX_BYTES,
  CODE_EXECUTION_TRUNCATION_MARKER,
} from '#shared/utils/code-execution'
import {
  compactCodeExecutionInput,
  compactCodeExecutionOutput,
} from '~~/server/utils/code-execution/compact'

describe('compactCodeExecutionInput', () => {
  it('reads the Anthropic programmatic, bash and editor inputs', () => {
    expect(compactCodeExecutionInput({
      type: 'programmatic-tool-call',
      code: 'print(1)',
    })).toEqual({ language: 'python', code: 'print(1)' })
    expect(compactCodeExecutionInput({
      type: 'bash_code_execution',
      command: 'ls -la',
    })).toEqual({ language: 'bash', code: 'ls -la' })
    expect(compactCodeExecutionInput({
      type: 'text_editor_code_execution',
      command: 'create',
      path: '/tmp/a.py',
      file_text: 'x = 1',
    })).toEqual({ language: 'text', code: 'create /tmp/a.py\nx = 1' })
  })

  it('reads the OpenAI and Gemini inputs and drops the container id', () => {
    const openai = compactCodeExecutionInput({
      code: 'print(2)',
      containerId: 'cntr_secret',
    })
    const google = compactCodeExecutionInput({
      language: 'PYTHON',
      code: 'print(3)',
    })

    expect(openai).toEqual({ language: 'python', code: 'print(2)' })
    expect(JSON.stringify(openai)).not.toContain('cntr_secret')
    expect(google).toEqual({ language: 'python', code: 'print(3)' })
  })

  it('caps the code at 32 KB with a truncation marker', () => {
    const compacted = compactCodeExecutionInput({
      code: 'a'.repeat(CODE_EXECUTION_CODE_MAX_BYTES * 2),
    })

    expect(compacted.codeTruncated).toBe(true)
    expect(compacted.code.endsWith(CODE_EXECUTION_TRUNCATION_MARKER)).toBe(true)
    expect(new TextEncoder().encode(compacted.code).byteLength)
      .toBeLessThanOrEqual(CODE_EXECUTION_CODE_MAX_BYTES)
  })

  it('is idempotent on an already compact input', () => {
    const once = compactCodeExecutionInput({ type: 'bash_code_execution', command: 'ls' })

    expect(compactCodeExecutionInput(once)).toEqual(once)
  })

  it('keeps the truncation flag when it compacts a truncated input again', () => {
    const once = compactCodeExecutionInput({
      code: 'a'.repeat(CODE_EXECUTION_CODE_MAX_BYTES * 2),
    })

    expect(compactCodeExecutionInput(once)).toEqual(once)
    expect(compactCodeExecutionInput(once).codeTruncated).toBe(true)
  })

  it('survives an unusable input', () => {
    expect(compactCodeExecutionInput(null)).toEqual({
      language: 'python',
      code: '',
    })
  })
})

describe('compactCodeExecutionOutput', () => {
  it('keeps stdout, stderr and the return code of every Anthropic result', () => {
    expect(compactCodeExecutionOutput({
      type: 'bash_code_execution_result',
      stdout: 'ok',
      stderr: 'warn',
      return_code: 2,
      content: [{ type: 'bash_code_execution_output', file_id: 'file_1' }],
    })).toEqual({
      output: { stdout: 'ok', stderr: 'warn', returnCode: 2 },
    })
  })

  it('drops the encrypted stdout and every provider file id', () => {
    const compacted = compactCodeExecutionOutput({
      type: 'encrypted_code_execution_result',
      encrypted_stdout: 'SECRET',
      stderr: '',
      return_code: 0,
      content: [{ type: 'code_execution_output', file_id: 'file_1' }],
    })

    expect(JSON.stringify(compacted)).not.toContain('SECRET')
    expect(JSON.stringify(compacted)).not.toContain('file_1')
  })

  it('reports a provider error result as error text', () => {
    expect(compactCodeExecutionOutput({
      type: 'code_execution_tool_result_error',
      error_code: 'too_many_requests',
    }).errorText).toBe('too_many_requests')
  })

  it('reads text editor results', () => {
    expect(compactCodeExecutionOutput({
      type: 'text_editor_code_execution_create_result',
      is_file_update: false,
    }).output.stdout).toBe('File created.')
    expect(compactCodeExecutionOutput({
      type: 'text_editor_code_execution_view_result',
      content: 'line 1',
    }).output.stdout).toBe('line 1')
  })

  it('joins OpenAI logs and ignores image URLs', () => {
    const compacted = compactCodeExecutionOutput({
      outputs: [
        { type: 'logs', logs: 'a' },
        { type: 'image', url: 'https://example.invalid/x.png' },
        { type: 'logs', logs: 'b' },
      ],
    })

    expect(compacted.output.stdout).toBe('a\nb')
    expect(JSON.stringify(compacted)).not.toContain('example.invalid')
  })

  it('maps a Gemini outcome to stdout or stderr', () => {
    expect(compactCodeExecutionOutput({
      outcome: 'OUTCOME_OK',
      output: '45',
    }).output).toEqual({ stdout: '45', stderr: '', returnCode: 0 })
    expect(compactCodeExecutionOutput({
      outcome: 'OUTCOME_FAILED',
      output: 'Traceback',
    }).output).toEqual({ stdout: '', stderr: 'Traceback', returnCode: 1 })
  })

  it('caps stdout and stderr and flags the truncation', () => {
    const compacted = compactCodeExecutionOutput({
      type: 'code_execution_result',
      stdout: 'x'.repeat(CODE_EXECUTION_STREAM_MAX_BYTES * 2),
      stderr: 'y'.repeat(CODE_EXECUTION_STREAM_MAX_BYTES * 2),
      return_code: 0,
    })

    expect(compacted.output.stdoutTruncated).toBe(true)
    expect(compacted.output.stderrTruncated).toBe(true)
    expect(compacted.output.stdout.endsWith(
      CODE_EXECUTION_TRUNCATION_MARKER,
    )).toBe(true)
  })

  it('is idempotent on an already compact output', () => {
    const once = compactCodeExecutionOutput({
      type: 'code_execution_result',
      stdout: 'x'.repeat(CODE_EXECUTION_STREAM_MAX_BYTES * 2),
      stderr: '',
      return_code: 1,
    })

    expect(compactCodeExecutionOutput(once.output)).toEqual(once)
  })
})
