export const GOOGLE_ENTRY_IDS = [
  'google-drive',
  'google-gmail',
  'google-calendar',
] as const

export type GoogleEntryId = typeof GOOGLE_ENTRY_IDS[number]

export const GOOGLE_CONNECTORS_PATH = '/chats/connectors'

export const GOOGLE_KEYS_TAB_PATH = '/profile/keys?tab=google'

export const GOOGLE_LABS_PATH = '/profile/labs'

export const GOOGLE_ENTRY_PANEL_QUERY_KEY = 'panel'

export const GOOGLE_ENTRY_SEARCH_KEYWORDS: Readonly<
  Record<GoogleEntryId, readonly string[]>
> = {
  'google-drive': ['google', 'drive', 'docs', 'sheets', 'slides'],
  'google-gmail': ['google', 'gmail'],
  'google-calendar': ['google', 'calendar'],
}

const SEARCH_TOKEN_MIN_LENGTH = 2

export function isGoogleEntryId(value: unknown): value is GoogleEntryId {
  return GOOGLE_ENTRY_IDS.some((id) => {
    return id === value
  })
}

/**
 * The page that opens an entry's panel. It is also what the connect routes
 * get as `returnTo`, so a Google round trip lands on the entry it started
 * from.
 */
export function buildGoogleEntryPath(entryId: GoogleEntryId): string {
  return `${GOOGLE_CONNECTORS_PATH}?${GOOGLE_ENTRY_PANEL_QUERY_KEY}=${entryId}`
}

/**
 * Where a user connects Google Drive: its panel on the Connectors page, or
 * the Google tab of API Keys for an account without the `connectors` flag.
 */
export function getGoogleDriveSettingsPath(
  isConnectorsActive: boolean,
): string {
  return isConnectorsActive
    ? buildGoogleEntryPath('google-drive')
    : GOOGLE_KEYS_TAB_PATH
}

/**
 * The entries a directory search shows above its results: every entry whose
 * keywords start with one of the words the user typed.
 */
export function findGoogleEntriesForSearch(query: string): GoogleEntryId[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length >= SEARCH_TOKEN_MIN_LENGTH)

  if (!tokens.length) {
    return []
  }

  return GOOGLE_ENTRY_IDS.filter((entryId) => {
    return tokens.some((token) => {
      return GOOGLE_ENTRY_SEARCH_KEYWORDS[entryId].some((keyword) => {
        return keyword.startsWith(token)
      })
    })
  })
}
