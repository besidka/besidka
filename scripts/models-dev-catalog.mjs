/**
 * Fetches the full models.dev catalog (every provider, every model). Shared
 * by scripts/fetch-models-metadata.mjs (the snapshot refresh) and
 * scripts/propose-model-successors.mjs (the successor-detection CLI) so
 * both read from one source of truth for the network call, instead of each
 * defining its own copy.
 */

const CATALOG_URL = 'https://models.dev/api.json'
const FETCH_TIMEOUT_MS = 60_000

export async function fetchCatalog() {
  try {
    const response = await fetch(CATALOG_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(
        `${CATALOG_URL} responded ${response.status} ${response.statusText}`,
      )
      process.exit(1)
    }

    return await response.json()
  } catch (exception) {
    console.error(`Could not fetch ${CATALOG_URL}: ${exception.message}`)
    process.exit(1)
  }
}
