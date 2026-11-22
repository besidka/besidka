import { describe, expect, it, vi } from 'vitest'
import {
  collectAnthropicContainerFileRefs,
  downloadContainerFile,
  isContainerFileCitationChunk,
  readOpenAiContainerFileCitation,
} from '~~/server/utils/code-execution/container-files'

const logger = { set: vi.fn() }

function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }

      controller.close()
    },
  })
}

function anthropicFetcher(options: {
  metadata?: Record<string, unknown>
  metadataStatus?: number
  content?: Response
}) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/content')) {
      return options.content ?? new Response(new Uint8Array([1, 2, 3]))
    }

    return new Response(
      JSON.stringify(options.metadata ?? {
        filename: 'chart.png',
        size_bytes: 3,
        downloadable: true,
      }),
      { status: options.metadataStatus ?? 200 },
    )
  })
}

describe('collectAnthropicContainerFileRefs', () => {
  it('reads file ids from code and bash results only', () => {
    expect(collectAnthropicContainerFileRefs({
      type: 'bash_code_execution_result',
      content: [
        { type: 'bash_code_execution_output', file_id: 'file_a' },
        { type: 'code_execution_output', file_id: 'file_b' },
        { type: 'something_else', file_id: 'file_c' },
      ],
    })).toEqual([
      { provider: 'anthropic', fileId: 'file_a' },
      { provider: 'anthropic', fileId: 'file_b' },
    ])
  })

  it('ignores results without files and unsafe ids', () => {
    expect(collectAnthropicContainerFileRefs({ stdout: 'x' })).toEqual([])
    expect(collectAnthropicContainerFileRefs({
      content: [{ type: 'code_execution_output', file_id: '../etc/passwd' }],
    })).toEqual([])
    expect(collectAnthropicContainerFileRefs(null)).toEqual([])
  })
})

describe('OpenAI container file citations', () => {
  const chunk = {
    filename: 'out.csv',
    title: 'out.csv',
    providerMetadata: {
      openai: {
        type: 'container_file_citation',
        fileId: 'cfile_1',
        containerId: 'cntr_1',
      },
    },
  }

  it('reads the container and file ids from the source chunk', () => {
    expect(readOpenAiContainerFileCitation(chunk)).toEqual({
      provider: 'openai',
      fileId: 'cfile_1',
      containerId: 'cntr_1',
      filename: 'out.csv',
    })
    expect(isContainerFileCitationChunk(chunk)).toBe(true)
  })

  it('ignores other citations and unsafe ids', () => {
    expect(readOpenAiContainerFileCitation({
      providerMetadata: { openai: { type: 'file_citation', fileId: 'f' } },
    })).toBeNull()
    expect(readOpenAiContainerFileCitation({
      providerMetadata: {
        openai: {
          type: 'container_file_citation',
          fileId: 'a/b',
          containerId: 'cntr_1',
        },
      },
    })).toBeNull()
    expect(isContainerFileCitationChunk({})).toBe(false)
  })
})

describe('downloadContainerFile', () => {
  it('downloads an Anthropic file with the user key, never following redirects', async () => {
    const fetcher = anthropicFetcher({})
    const result = await downloadContainerFile({
      ref: { provider: 'anthropic', fileId: 'file_1' },
      apiKey: 'user-key',
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)

    expect(result).toEqual({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      filename: 'chart.png',
    })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.anthropic.com/v1/files/file_1',
      'https://api.anthropic.com/v1/files/file_1/content',
    ])

    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({
        method: 'GET',
        redirect: 'manual',
        headers: {
          'x-api-key': 'user-key',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
        },
      })
    }
  })

  it('downloads an OpenAI container file by container and file id', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([9])))
    const result = await downloadContainerFile({
      ref: {
        provider: 'openai',
        fileId: 'cfile_1',
        containerId: 'cntr_1',
        filename: 'out.csv',
      },
      apiKey: 'user-key',
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)

    expect(result).toMatchObject({ ok: true, filename: 'out.csv' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/containers/cntr_1/files/cfile_1/content',
    )
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      headers: { Authorization: 'Bearer user-key' },
    })
  })

  it('skips an Anthropic file whose metadata says it is too large, without downloading it', async () => {
    const fetcher = anthropicFetcher({
      metadata: { filename: 'big.csv', size_bytes: 50 * 1024 * 1024 },
    })
    const result = await downloadContainerFile({
      ref: { provider: 'anthropic', fileId: 'file_1' },
      apiKey: 'k',
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)

    expect(result).toEqual({ ok: false, reason: 'too-large' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses a body whose Content-Length is over the cap', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(streamOf(new Uint8Array(4)), {
        headers: { 'content-length': '999' },
      })
    })
    const result = await downloadContainerFile({
      ref: {
        provider: 'openai',
        fileId: 'f',
        containerId: 'c',
        filename: 'a.csv',
      },
      apiKey: 'k',
      maxBytes: 100,
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)

    expect(result).toEqual({ ok: false, reason: 'too-large' })
  })

  it('aborts a stream that grows past the cap without a Content-Length', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(60))
      },
      cancel,
    })
    const fetcher = vi.fn(async () => new Response(body))
    const result = await downloadContainerFile({
      ref: {
        provider: 'openai',
        fileId: 'f',
        containerId: 'c',
        filename: 'a.csv',
      },
      apiKey: 'k',
      maxBytes: 100,
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)

    expect(result).toEqual({ ok: false, reason: 'too-large' })
    expect(cancel).toHaveBeenCalled()
  })

  it('treats a redirect and an error status as a failed download', async () => {
    const redirect = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.invalid/x' },
      })
    })
    const failure = vi.fn(async () => new Response('no', { status: 404 }))
    const ref = {
      provider: 'openai' as const,
      fileId: 'f',
      containerId: 'c',
      filename: 'a.csv',
    }

    expect(await downloadContainerFile({
      ref,
      apiKey: 'k',
      fetcher: redirect as unknown as typeof fetch,
    }, logger)).toEqual({ ok: false, reason: 'download-failed' })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(await downloadContainerFile({
      ref,
      apiKey: 'k',
      fetcher: failure as unknown as typeof fetch,
    }, logger)).toEqual({ ok: false, reason: 'download-failed' })
  })

  it('turns a network error or timeout into a failed download', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })

    expect(await downloadContainerFile({
      ref: { provider: 'anthropic', fileId: 'file_1' },
      apiKey: 'k',
      fetcher: fetcher as unknown as typeof fetch,
    }, logger)).toEqual({ ok: false, reason: 'download-failed' })
  })

  it('never puts the key in the log', async () => {
    logger.set.mockClear()

    await downloadContainerFile({
      ref: { provider: 'anthropic', fileId: 'file_1' },
      apiKey: 'sk-secret-key',
      fetcher: vi.fn(async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    }, logger)

    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('sk-secret-key')
  })
})
