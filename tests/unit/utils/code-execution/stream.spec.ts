import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import anthropicChart from '../../../fixtures/code-execution/anthropic-chart.json'
import googleStdout from '../../../fixtures/code-execution/google-stdout.json'
import openaiCsv from '../../../fixtures/code-execution/openai-csv.json'
import { createProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import { createCodeExecutionStream } from '~~/server/utils/code-execution/stream'

type PersistFiles = NonNullable<
  Parameters<typeof createCodeExecutionStream>[0]['persistFiles']
>

const logger = { set: vi.fn() }
const rates = {
  openaiPerSessionUsd: 0.03,
  anthropicPerHourUsd: 0.05,
  anthropicFreeHoursPerMonth: 1550,
}

function toStream(chunks: unknown[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk as UIMessageChunk)
      }

      controller.close()
    },
  })
}

async function collect(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      return chunks
    }

    chunks.push(value)
  }
}

function createDeleteFetcher() {
  return vi.fn(async () => new Response(null, { status: 204 }))
}

function createSetup(options: {
  provider: 'anthropic' | 'openai' | 'google'
  persistFiles?: PersistFiles
  filesEnabled?: boolean
  fetcher?: ReturnType<typeof createDeleteFetcher>
}) {
  const fetcher = options.fetcher ?? createDeleteFetcher()
  const tracker = createProviderResourceTracker({
    provider: options.provider,
    apiKey: 'user-key',
    logger,
    fetcher: fetcher as unknown as typeof fetch,
  })
  const persistFiles = options.persistFiles ?? vi.fn(async () => ({
    saved: [],
    skipped: [],
    provenanceMissing: 0,
  })) as unknown as PersistFiles
  const codeExecution = createCodeExecutionStream({
    provider: options.provider,
    modelId: 'test-model',
    userId: 1,
    apiKey: 'user-key',
    filesEnabled: options.filesEnabled ?? true,
    tracker,
    rates,
    logger,
    persistFiles,
  })

  return { codeExecution, fetcher, persistFiles, tracker }
}

function byType(chunks: UIMessageChunk[], type: string) {
  return chunks.filter(chunk => chunk.type === type)
}

describe('createCodeExecutionStream', () => {
  it('compacts an Anthropic run, drops the encrypted payload and saves files at the end of the step', async () => {
    const persistFiles = vi.fn(async () => ({
      saved: [{
        fileId: 'file-row-1',
        url: '/files/abc.png?generated=1',
        filename: 'chart.png',
        mediaType: 'image/png',
        bytes: 1234,
      }],
      skipped: [{ filename: 'archive.zip', reason: 'type-not-allowed' }],
      provenanceMissing: 0,
    })) as unknown as PersistFiles
    const { codeExecution, fetcher } = createSetup({
      provider: 'anthropic',
      persistFiles,
    })
    const output = await collect(codeExecution.apply(toStream(anthropicChart)))
    const serialized = JSON.stringify(output)

    expect(serialized).not.toContain('ENCRYPTED-PAYLOAD-MUST-NOT-LEAK')
    expect(serialized).not.toContain('file_chart')
    expect(serialized).not.toContain('file_archive')

    const inputChunk = byType(output, 'tool-input-available')[0] as {
      input: Record<string, unknown>
    }

    expect(inputChunk.input).toEqual({
      language: 'python',
      code: expect.stringContaining('plt.savefig'),
    })

    const outputChunk = byType(output, 'tool-output-available')[0] as {
      output: Record<string, unknown>
    }

    expect(outputChunk.output).toEqual({
      stdout: '',
      stderr: '',
      returnCode: 0,
    })
    expect(persistFiles).toHaveBeenCalledTimes(1)
    expect(vi.mocked(persistFiles).mock.calls[0]?.[0].refs).toEqual([
      { provider: 'anthropic', fileId: 'file_chart' },
      { provider: 'anthropic', fileId: 'file_archive' },
    ])

    const fileChunk = byType(output, 'file')[0] as {
      url: string
      providerMetadata: { besidka: { filename: string } }
    }

    expect(fileChunk.url).toBe('/files/abc.png?generated=1')
    expect(fileChunk.providerMetadata.besidka.filename).toBe('chart.png')
    expect(byType(output, 'data-code-execution-files')[0]).toEqual({
      type: 'data-code-execution-files',
      data: {
        savedCount: 1,
        skipped: [{ filename: 'archive.zip', reason: 'type-not-allowed' }],
      },
    })
    expect(codeExecution.getSavedFileIds()).toEqual(['file-row-1'])

    const finishIndex = output.findIndex(chunk => chunk.type === 'finish')
    const fileIndex = output.findIndex(chunk => chunk.type === 'file')

    expect(fileIndex).toBeLessThan(finishIndex)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('collects OpenAI container citations, hides them from the stream and deletes the container once at the end', async () => {
    const persistFiles = vi.fn(async () => ({
      saved: [{
        fileId: 'file-row-2',
        url: '/files/def.csv?generated=1',
        filename: 'out.csv',
        mediaType: 'text/csv',
        bytes: 9,
      }],
      skipped: [],
      provenanceMissing: 0,
    })) as unknown as PersistFiles
    const { codeExecution, fetcher } = createSetup({
      provider: 'openai',
      persistFiles,
    })
    const output = await collect(codeExecution.apply(toStream(openaiCsv)))
    const serialized = JSON.stringify(output)

    expect(byType(output, 'source-document')).toHaveLength(0)
    expect(serialized).not.toContain('cfile_01')
    expect(serialized).not.toContain('ephemeral.png')
    expect(byType(output, 'tool-input-available')[0]).toMatchObject({
      input: { language: 'python' },
    })
    expect(
      (byType(output, 'tool-input-available')[0] as {
        input: Record<string, unknown>
      }).input,
    ).not.toHaveProperty('containerId')
    expect(byType(output, 'tool-output-available')[0]).toMatchObject({
      output: { stdout: '1', stderr: '', returnCode: null },
    })
    expect(vi.mocked(persistFiles).mock.calls[0]?.[0].refs).toEqual([{
      provider: 'openai',
      fileId: 'cfile_01',
      containerId: 'cntr_01',
      filename: 'out.csv',
    }])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/containers/cntr_01',
    )
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('shows Gemini stdout and never tries to save a file', async () => {
    const { codeExecution, fetcher, persistFiles } = createSetup({
      provider: 'google',
    })
    const output = await collect(codeExecution.apply(toStream(googleStdout)))

    expect(byType(output, 'tool-output-available')[0]).toMatchObject({
      output: { stdout: '45\n', stderr: '', returnCode: 0 },
    })
    expect(persistFiles).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(byType(output, 'file')).toHaveLength(0)
  })

  it('turns a provider error result into a tool error', async () => {
    const { codeExecution } = createSetup({ provider: 'anthropic' })
    const output = await collect(codeExecution.apply(toStream([
      {
        type: 'tool-input-available',
        toolCallId: 't1',
        toolName: 'code_execution',
        input: { type: 'bash_code_execution', command: 'ls' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 't1',
        output: {
          type: 'bash_code_execution_tool_result_error',
          error_code: 'unavailable',
        },
      },
      { type: 'finish' },
    ])))

    expect(byType(output, 'tool-output-error')[0]).toMatchObject({
      toolCallId: 't1',
      errorText: 'unavailable',
    })
    expect(byType(output, 'tool-output-available')).toHaveLength(0)
  })

  it('does not download files when code-execution.files is off but still deletes the provider copies', async () => {
    const { codeExecution, fetcher, persistFiles } = createSetup({
      provider: 'anthropic',
      filesEnabled: false,
    })
    const output = await collect(codeExecution.apply(toStream(anthropicChart)))

    expect(persistFiles).not.toHaveBeenCalled()
    expect(byType(output, 'file')).toHaveLength(0)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.anthropic.com/v1/files/file_chart',
      'https://api.anthropic.com/v1/files/file_archive',
    ])
  })

  it('deletes the provider copies when the stream errors before finishing', async () => {
    const { codeExecution, fetcher, persistFiles } = createSetup({
      provider: 'anthropic',
    })
    const chunks = anthropicChart.filter((chunk) => {
      return chunk.type !== 'finish-step' && chunk.type !== 'finish'
    })

    await collect(codeExecution.apply(toStream([
      ...chunks,
      { type: 'error', errorText: 'boom' },
    ])))

    expect(persistFiles).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.anthropic.com/v1/files/file_chart',
      'https://api.anthropic.com/v1/files/file_archive',
    ])
  })

  it('keeps the stream alive and lists every file as not saved when storing the files throws', async () => {
    const persistFiles = vi.fn(async () => {
      throw new Error('policy lookup failed')
    }) as unknown as PersistFiles
    const { codeExecution, fetcher } = createSetup({
      provider: 'anthropic',
      persistFiles,
    })
    const output = await collect(codeExecution.apply(toStream(anthropicChart)))

    expect(output.at(-1)?.type).toBe('finish')
    expect(byType(output, 'file')).toHaveLength(0)
    expect(byType(output, 'data-code-execution-files')[0]).toEqual({
      type: 'data-code-execution-files',
      data: {
        savedCount: 0,
        skipped: [
          { filename: 'file', reason: 'download-failed' },
          { filename: 'file', reason: 'download-failed' },
        ],
      },
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('delivers the finish chunk before it deletes anything at the provider', async () => {
    const order: string[] = []
    const fetcher = vi.fn(async () => {
      order.push('delete')

      return new Response(null, { status: 204 })
    })
    const { codeExecution } = createSetup({
      provider: 'anthropic',
      fetcher: fetcher as unknown as ReturnType<typeof createDeleteFetcher>,
    })
    const reader = codeExecution.apply(toStream(anthropicChart)).getReader()

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      order.push(value.type)
    }

    expect(order.indexOf('finish')).toBeLessThan(order.indexOf('delete'))
  })

  it('logs the usage with the cost the rates allow', async () => {
    logger.set.mockClear()

    const { codeExecution } = createSetup({ provider: 'openai' })

    await collect(codeExecution.apply(toStream(openaiCsv)))

    const usageCall = logger.set.mock.calls.find((call) => {
      return call[0]?.attributes?.codeExecution
    })

    expect(usageCall?.[0].attributes.codeExecution).toMatchObject({
      provider: 'openai',
      calls: 1,
      containers: 1,
      cost: 0.03,
    })
  })

  it('leaves other tools and text untouched', async () => {
    const { codeExecution } = createSetup({ provider: 'anthropic' })
    const chunks = [
      { type: 'text-delta', id: 'a', delta: 'hello' },
      {
        type: 'tool-input-available',
        toolCallId: 'other',
        toolName: 'web_search_preview',
        input: { query: 'x' },
      },
      { type: 'finish' },
    ]
    const output = await collect(codeExecution.apply(toStream(chunks)))

    expect(output).toEqual(chunks)
  })
})
