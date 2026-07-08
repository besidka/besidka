import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function importAdapter() {
  return import(
    '../../../../../server/utils/research/adapters/openai'
  )
}

describe('openai research adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts a background responses job with web search and reasoning summary', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_abc123',
      status: 'queued',
    }), { status: 200 }))

    const { openAiResearchAdapter } = await importAdapter()

    const result = await openAiResearchAdapter.start({
      apiKey: 'sk-test',
      modelId: 'o4-mini-deep-research',
      level: 'quick',
      brief: 'Research the topic',
    })

    expect(result).toEqual({ providerJobId: 'resp_abc123', status: 'running' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test',
        }),
      }),
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)

    expect(body.model).toBe('o4-mini-deep-research')
    expect(body.background).toBe(true)
    expect(body.store).toBe(true)
    expect(body.max_tool_calls).toBe(20)
    expect(body.reasoning).toEqual({ summary: 'auto' })
    expect(body.tools).toEqual([{ type: 'web_search_preview' }])
    expect(body.input[1]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'Research the topic' }],
    })
    expect(JSON.stringify(init)).not.toContain('sk-test-leak')
  })

  it('uses a higher tool-call budget for the thorough level', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_abc123',
      status: 'queued',
    }), { status: 200 }))

    const { openAiResearchAdapter } = await importAdapter()

    await openAiResearchAdapter.start({
      apiKey: 'sk-test',
      modelId: 'o3-deep-research',
      level: 'thorough',
      brief: 'Research the topic',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)

    expect(body.max_tool_calls).toBe(60)
  })

  it.each([
    ['queued', 'running'],
    ['in_progress', 'running'],
    ['completed', 'completed'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['incomplete', 'failed'],
  ])('maps OpenAI status %s to %s', async (providerStatus, expectedStatus) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: providerStatus,
    }), { status: 200 }))

    const { openAiResearchAdapter } = await importAdapter()

    const result = await openAiResearchAdapter.status(
      'resp_abc123',
      'sk-test',
    )

    expect(result.status).toBe(expectedStatus)
  })

  it('rejects a malformed provider job id before building a URL', async () => {
    const { openAiResearchAdapter } = await importAdapter()

    await expect(openAiResearchAdapter.status(
      '../../etc/passwd',
      'sk-test',
    )).rejects.toThrow('Invalid OpenAI research job id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('extracts report text, deduped sources, and usage from the result', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'First part.',
              annotations: [
                { url: 'https://example.com/a', title: 'Example A' },
                { url: 'https://example.com/a', title: 'Duplicate' },
              ],
            },
            {
              type: 'output_text',
              text: 'Second part.',
              annotations: [
                { url: 'https://example.com/b', title: 'Example B' },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
    }), { status: 200 }))

    const { openAiResearchAdapter } = await importAdapter()

    const result = await openAiResearchAdapter.result(
      'resp_abc123',
      'sk-test',
    )

    expect(result.reportText).toBe('First part.\n\nSecond part.')
    expect(result.sources).toEqual([
      { sourceId: 'src-0', url: 'https://example.com/a', title: 'Example A' },
      { sourceId: 'src-1', url: 'https://example.com/b', title: 'Example B' },
    ])
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      toolCalls: 1,
    })
  })

  it('throws a structured error carrying status and body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Your organization must be verified to use this model.' },
    }), { status: 403 }))

    const { openAiResearchAdapter } = await importAdapter()

    await expect(openAiResearchAdapter.status('resp_abc123', 'sk-test'))
      .rejects.toMatchObject({
        status: 403,
        body: {
          error: {
            message: 'Your organization must be verified to use this model.',
          },
        },
      })
  })

  it('cancels a job and tolerates an already-gone (404) response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    const { openAiResearchAdapter } = await importAdapter()

    await expect(openAiResearchAdapter.cancel('resp_abc123', 'sk-test'))
      .resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses/resp_abc123/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
