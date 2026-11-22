import { describe, expect, it } from 'vitest'
import type { NuxtApp } from '#app'
import {
  GOOGLE_CONNECTION_FETCH_KEY,
  readCachedConnection,
} from '../../../app/composables/google-connection'

const cached = { connection: null, canConnect: true, dedicatedClient: false }

function nuxtAppWith(data: Record<string, unknown>): NuxtApp {
  return {
    payload: { data },
    static: { data: {} },
  } as unknown as NuxtApp
}

describe('useGoogleConnection cache', () => {
  it('reuses the status fetched earlier in the session', () => {
    const nuxtApp = nuxtAppWith({ [GOOGLE_CONNECTION_FETCH_KEY]: cached })

    expect(readCachedConnection(
      GOOGLE_CONNECTION_FETCH_KEY,
      nuxtApp,
      { cause: 'initial' },
    )).toEqual(cached)
  })

  it('fetches again on a manual refresh', () => {
    const nuxtApp = nuxtAppWith({ [GOOGLE_CONNECTION_FETCH_KEY]: cached })

    expect(readCachedConnection(
      GOOGLE_CONNECTION_FETCH_KEY,
      nuxtApp,
      { cause: 'refresh:manual' },
    )).toBeUndefined()
  })
})
