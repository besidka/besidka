import { describe, expect, it } from 'vitest'
import {
  buildSearchProviderStatusError,
} from '../../../../server/utils/search/search-error'

describe('buildSearchProviderStatusError', () => {
  it.each([400, 422])('maps %i to a non-transient invalid request error',
    (status) => {
      const details = buildSearchProviderStatusError({
        providerLabel: 'Exa',
        status,
      })

      expect(details.message).toBe('Exa rejected the search request as invalid.')
      expect(details.message).not.toContain('temporarily unavailable')
      expect(details.status).toBe(status)
    })

  it('keeps 5xx as a transient outage', () => {
    const details = buildSearchProviderStatusError({
      providerLabel: 'Exa',
      status: 503,
    })

    expect(details.message).toBe('Exa is temporarily unavailable.')
  })

  it('keeps key and quota statuses distinct', () => {
    expect(buildSearchProviderStatusError({
      providerLabel: 'Exa',
      status: 401,
    }).message).toContain('rejected the saved API key')
    expect(buildSearchProviderStatusError({
      providerLabel: 'Exa',
      status: 429,
    }).message).toContain('rate limited')
  })
})
