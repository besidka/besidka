import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { finalizeCodeExecutionParts } from '~~/server/utils/code-execution/message-parts'

function parts(...items: unknown[]): UIMessage['parts'] {
  return items as UIMessage['parts']
}

describe('finalizeCodeExecutionParts', () => {
  it('drops a run that never finished', () => {
    expect(finalizeCodeExecutionParts(parts(
      { type: 'tool-code_execution', toolCallId: 'a', state: 'input-available', input: {} },
      { type: 'text', text: 'hi' },
    ))).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('compacts a finished run again and never keeps provider output fields', () => {
    const [part] = finalizeCodeExecutionParts(parts({
      type: 'tool-code_execution',
      toolCallId: 'a',
      state: 'output-available',
      providerExecuted: true,
      input: { type: 'bash_code_execution', command: 'ls' },
      output: {
        type: 'bash_code_execution_result',
        stdout: 'x',
        stderr: '',
        return_code: 0,
        content: [{ type: 'bash_code_execution_output', file_id: 'file_9' }],
      },
    })) as unknown as Array<Record<string, unknown>>

    expect(part).toEqual({
      type: 'tool-code_execution',
      toolCallId: 'a',
      state: 'output-available',
      input: { language: 'bash', code: 'ls' },
      output: { stdout: 'x', stderr: '', returnCode: 0 },
    })
  })

  it('keeps a failed run with its error text', () => {
    expect(finalizeCodeExecutionParts(parts({
      type: 'tool-code_execution',
      toolCallId: 'a',
      state: 'output-error',
      input: { code: 'x' },
      errorText: 'unavailable',
    }))).toEqual([{
      type: 'tool-code_execution',
      toolCallId: 'a',
      state: 'output-error',
      input: { language: 'python', code: 'x' },
      errorText: 'unavailable',
    }])
  })

  it('removes OpenAI container file citations and keeps other sources', () => {
    const result = finalizeCodeExecutionParts(parts(
      {
        type: 'source-document',
        sourceId: 'a',
        title: 'out.csv',
        providerMetadata: {
          openai: {
            type: 'container_file_citation',
            fileId: 'cfile_1',
            containerId: 'cntr_1',
          },
        },
      },
      { type: 'source-url', sourceId: 'b', url: 'https://example.com' },
    ))

    expect(result).toEqual([
      { type: 'source-url', sourceId: 'b', url: 'https://example.com' },
    ])
  })

  it('gives a saved file its name back and drops the stream marker', () => {
    expect(finalizeCodeExecutionParts(parts({
      type: 'file',
      url: '/files/abc.csv?generated=1',
      mediaType: 'text/csv',
      providerMetadata: { besidka: { filename: 'out.csv' } },
    }))).toEqual([{
      type: 'file',
      url: '/files/abc.csv?generated=1',
      mediaType: 'text/csv',
      filename: 'out.csv',
    }])
  })

  it('merges the skipped-file notices of several steps into one part', () => {
    const result = finalizeCodeExecutionParts(parts(
      {
        type: 'data-code-execution-files',
        data: { savedCount: 1, skipped: [{ filename: 'a.zip', reason: 'type-not-allowed' }] },
      },
      { type: 'text', text: 'between' },
      {
        type: 'data-code-execution-files',
        data: { savedCount: 2, skipped: [{ filename: 'b.exe', reason: 'type-not-allowed' }] },
      },
    ))

    expect(result).toEqual([
      {
        type: 'data-code-execution-files',
        data: {
          savedCount: 3,
          skipped: [
            { filename: 'a.zip', reason: 'type-not-allowed' },
            { filename: 'b.exe', reason: 'type-not-allowed' },
          ],
        },
      },
      { type: 'text', text: 'between' },
    ])
  })

  it('leaves unrelated parts alone', () => {
    const unrelated = parts(
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'b' },
      { type: 'file', url: '/files/x.png', mediaType: 'image/png' },
    )

    expect(finalizeCodeExecutionParts(unrelated)).toEqual(unrelated)
  })
})
