export const NUXT_RELOAD_STORAGE_KEY = 'nuxt:reload'
export const CHUNK_RELOAD_GUARD_MS = 60_000
export const REPLY_IN_PROGRESS_STATE_KEY = 'chat-streaming'

const CHUNK_LOAD_ERROR_PATTERNS = [
  /importing a module script failed/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
  /loading (?:css )?chunk \S+ failed/i,
]

type ReloadGuardStorage = Pick<Storage, 'getItem'>

export type ChunkLoadRecovery = 'reloaded' | 'deferred' | 'blocked'

/**
 * Whether an error is a failed lazy chunk: after a deploy the page still
 * asks for the previous build's chunk filenames, which no longer exist.
 * Safari words it "Importing a module script failed.", Chromium "Failed to
 * fetch dynamically imported module", Firefox "error loading dynamically
 * imported module".
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) {
    return false
  }

  const name = (error as { name?: unknown }).name
  const message = typeof error === 'string'
    ? error
    : (error as { message?: unknown }).message

  if (name === 'ChunkLoadError') {
    return true
  }

  if (typeof message !== 'string') {
    return false
  }

  return CHUNK_LOAD_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Whether the page already reloaded itself for this path within the guard
 * window. Reads the record `reloadNuxtApp` keeps in `sessionStorage`
 * (`nuxt:reload`, `{ path, expires }`), so the guard adds no storage key of
 * its own. A storage that cannot be read counts as spent: without it
 * nothing could stop a reload loop.
 */
export function isChunkReloadSpent(
  storage: ReloadGuardStorage | undefined,
  path: string,
  now: number = Date.now(),
): boolean {
  if (!storage) {
    return true
  }

  try {
    const record = JSON.parse(
      storage.getItem(NUXT_RELOAD_STORAGE_KEY) || '{}',
    ) as { path?: unknown, expires?: unknown }

    return record.path === path
      && typeof record.expires === 'number'
      && record.expires > now
  } catch {
    return true
  }
}

/**
 * What to do about a stale chunk: reload once (`reloaded`; the caller's
 * `reload` must go through `reloadNuxtApp` with `CHUNK_RELOAD_GUARD_MS` as
 * its `ttl`, which records the guard), wait while a reply is still
 * streaming so the reload never cuts it off (`deferred`, the caller
 * reloads when the reply ends), or nothing when the composer holds an
 * unsent message (a reload could lose it) or the page already reloaded for
 * this path in the guard window (`blocked`, the caller asks the user to
 * reload).
 */
export function recoverFromChunkLoadError(input: {
  isReplyInProgress: boolean
  hasUnsentDraft: boolean
  storage: ReloadGuardStorage | undefined
  path: string
  reload: () => void
  now?: number
}): ChunkLoadRecovery {
  if (input.isReplyInProgress) {
    return 'deferred'
  }

  if (
    input.hasUnsentDraft
    || isChunkReloadSpent(input.storage, input.path, input.now)
  ) {
    return 'blocked'
  }

  input.reload()

  return 'reloaded'
}
