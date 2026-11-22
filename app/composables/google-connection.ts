import type { NuxtApp } from '#app'
import type { GoogleConnectionStatusResponse } from '#shared/utils/google-connections'

export const GOOGLE_CONNECTION_FETCH_KEY = 'google-drive-connection'

export function readCachedConnection(
  key: string,
  nuxtApp: NuxtApp,
  context: { cause: string },
): GoogleConnectionStatusResponse | undefined {
  if (context.cause === 'refresh:manual') {
    return undefined
  }

  return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
}

/**
 * The Google Drive connection status of the API Keys page. Fetched once
 * per session and reused when the page is opened again; `refresh()` after
 * a connect or disconnect fetches it anew. The status route needs only a
 * session, so a connected user sees the connection even while the
 * `google.drive` flag is off.
 */
export function useGoogleConnection() {
  return useLazyFetch('/api/v1/google/connections', {
    key: GOOGLE_CONNECTION_FETCH_KEY,
    getCachedData: readCachedConnection,
  })
}
