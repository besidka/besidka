import { describe, expect, it } from 'vitest'

async function importAdapter() {
  return import(
    '../../../../../server/utils/research/adapters/mock'
  )
}

describe('mock research adapter', () => {
  it('starts with a mock_<epoch>_<ulid> sentinel job id and running status', async () => {
    const { mockResearchAdapter } = await importAdapter()

    const result = await mockResearchAdapter.start({
      apiKey: 'sk-test',
      modelId: 'o4-mini-deep-research',
      tier: 'quick',
      brief: 'Research the topic',
    })

    expect(result.status).toBe('running')
    expect(result.providerJobId).toMatch(/^mock_\d+_[0-9A-Za-z]+$/)
  })

  it('reports running before the 45s completion delay elapses', async () => {
    const { mockResearchAdapter } = await importAdapter()
    const providerJobId = `mock_${Date.now()}_01ARZ3NDEKTSV4RRFFQ69G5FAV`

    const result = await mockResearchAdapter.status(providerJobId, 'sk-test')

    expect(result.status).toBe('running')
  })

  it('reports completed once the 45s completion delay has elapsed', async () => {
    const { mockResearchAdapter } = await importAdapter()
    const startMs = Date.now() - 46_000
    const providerJobId = `mock_${startMs}_01ARZ3NDEKTSV4RRFFQ69G5FAV`

    const result = await mockResearchAdapter.status(providerJobId, 'sk-test')

    expect(result.status).toBe('completed')
  })

  it('rejects a malformed provider job id', async () => {
    const { mockResearchAdapter } = await importAdapter()

    await expect(mockResearchAdapter.status('not-a-mock-id', 'sk-test'))
      .rejects.toThrow('Invalid mock research job id')
  })

  it('returns a canned report with the mock banner, citations, usage, and trace', async () => {
    const { mockResearchAdapter } = await importAdapter()

    const result = await mockResearchAdapter.result(
      'mock_1_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      'sk-test',
    )

    expect(result.reportText).toContain('**Mock research report**')
    expect(result.reportText).toContain('no provider spend')
    expect(result.sources.length).toBeGreaterThanOrEqual(3)
    expect(result.sources.length).toBeLessThanOrEqual(5)

    for (const source of result.sources) {
      expect(source.url).toMatch(/^https:\/\//)
    }

    expect(result.usage).toEqual(expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }))
    expect(result.trace?.length).toBeGreaterThanOrEqual(6)
    expect(result.trace?.some(entry => entry.kind === 'thought')).toBe(true)
    expect(result.trace?.some(entry => entry.kind === 'search')).toBe(true)
    expect(result.trace?.some(entry => entry.kind === 'read')).toBe(true)
  })

  it('resolves without throwing on cancel (no-op)', async () => {
    const { mockResearchAdapter } = await importAdapter()

    await expect(mockResearchAdapter.cancel(
      'mock_1_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      'sk-test',
    )).resolves.toBeUndefined()
  })
})
