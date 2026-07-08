import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function importAdapter() {
  return import(
    '../../../../../server/utils/research/adapters/google'
  )
}

describe('google research adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts an interaction with the deep-research agent config', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'interaction-abc',
      status: 'in_progress',
    }), { status: 200 }))

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.start({
      apiKey: 'goog-test-key',
      modelId: 'deep-research-preview-04-2026',
      level: 'quick',
      brief: 'Research the topic',
    })

    expect(result).toEqual({
      providerJobId: 'interaction-abc',
      status: 'running',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-goog-api-key': 'goog-test-key',
        }),
      }),
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)

    expect(body.agent).toBe('deep-research-preview-04-2026')
    expect(body.background).toBe(true)
    expect(body.store).toBe(true)
    expect(body.agent_config).toEqual({
      type: 'deep-research',
      thinking_summaries: 'auto',
      collaborative_planning: false,
    })
    expect(body.input).toContain('Research the topic')
  })

  it.each([
    ['in_progress', 'running'],
    ['completed', 'completed'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['incomplete', 'failed'],
    ['budget_exceeded', 'failed'],
    ['something_unknown', 'running'],
  ])('maps Google status %s to %s', async (providerStatus, expectedStatus) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: providerStatus,
    }), { status: 200 }))

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.status(
      'interaction-abc',
      'goog-test-key',
    )

    expect(result.status).toBe(expectedStatus)
  })

  it('rejects a malformed provider job id before building a URL', async () => {
    const { googleResearchAdapter } = await importAdapter()

    await expect(googleResearchAdapter.status(
      'not valid/id',
      'goog-test-key',
    )).rejects.toThrow('Invalid Google research job id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('extracts the last step text and never throws on an unexpected shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [
        { content: [{ text: 'Intermediate thought' }] },
        { content: [] },
      ],
    }), { status: 200 }))

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.result(
      'interaction-abc',
      'goog-test-key',
    )

    expect(result.reportText).toBe('Intermediate thought')
    expect(result.sources).toEqual([])
  })

  it('deduplicates sources discovered anywhere in the final step, capped at 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [
        {
          content: [{ text: 'Report body' }],
          citations: [
            { uri: 'https://example.com/a', title: 'A' },
            { uri: 'https://example.com/a', title: 'A duplicate' },
            { nested: { url: 'https://example.com/b' } },
          ],
        },
      ],
    }), { status: 200 }))

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.result(
      'interaction-abc',
      'goog-test-key',
    )

    expect(result.sources).toEqual([
      { sourceId: 'src-0', url: 'https://example.com/a', title: 'A' },
      { sourceId: 'src-1', url: 'https://example.com/b', title: undefined },
    ])
  })

  it('returns no sources when the final step has an unrecognized schema', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [{ unexpected: 'shape', nested: { deeper: null } }],
    }), { status: 200 }))

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.result(
      'interaction-abc',
      'goog-test-key',
    )

    expect(result.reportText).toBe('')
    expect(result.sources).toEqual([])
  })

  it('throws a structured error carrying status and body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'The caller does not have permission' },
    }), { status: 403 }))

    const { googleResearchAdapter } = await importAdapter()

    await expect(googleResearchAdapter.status(
      'interaction-abc',
      'goog-test-key',
    )).rejects.toMatchObject({
      status: 403,
      body: { error: { message: 'The caller does not have permission' } },
    })
  })

  it('bounds recursion depth on a deeply nested source-candidate tree', async () => {
    const deepestLevel = 200000
    let node: Record<string, unknown> = {
      uri: `https://example.com/level-${deepestLevel}`,
    }

    for (let level = deepestLevel - 1; level >= 0; level -= 1) {
      node = { uri: `https://example.com/level-${level}`, nested: node }
    }

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        steps: [node],
      }),
    })

    const { googleResearchAdapter } = await importAdapter()

    const result = await googleResearchAdapter.result(
      'interaction-abc',
      'goog-test-key',
    )

    expect(result.sources.length).toBe(9)
    expect(result.sources[0]?.url).toBe('https://example.com/level-0')
    expect(result.sources[8]?.url).toBe('https://example.com/level-8')
  })

  it('cancels a job and tolerates an already-gone (404) response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    const { googleResearchAdapter } = await importAdapter()

    await expect(googleResearchAdapter.cancel(
      'interaction-abc',
      'goog-test-key',
    )).resolves.toBeUndefined()
  })
})
