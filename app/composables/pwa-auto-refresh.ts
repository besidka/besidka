export const PWA_REFRESHER_DISMISS_INTERVAL_MS = 30 * 60 * 1000

const PWA_AUTO_APPLY_GUARD_TTL_MS = 5 * 60 * 1000
const PWA_REFRESHER_DISMISS_STORAGE_KEY = 'pwa:refresher-dismissed-until'
const PWA_AUTO_APPLY_GUARD_STORAGE_KEY = 'pwa:auto-refresh-applied-until'

function readSessionStorageValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSessionStorageValue(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    return
  }
}

export function readPwaRefresherDismissedUntil(): number {
  const raw = readSessionStorageValue(PWA_REFRESHER_DISMISS_STORAGE_KEY)

  return raw ? Number(raw) || 0 : 0
}

export function writePwaRefresherDismissedUntil(timestamp: number): void {
  writeSessionStorageValue(
    PWA_REFRESHER_DISMISS_STORAGE_KEY,
    String(timestamp),
  )
}

// A worker version isn't observable from the client, so a bounded cooldown
// stands in for "per new worker": it lets one auto-apply through immediately,
// then blocks further attempts for the cooldown window even if needRefresh
// somehow never clears (e.g. the Studio service-worker conflict documented in
// app.vue), which would otherwise reload the hidden tab on every
// visibilitychange forever.
export function hasRecentPwaAutoApply(now: number = Date.now()): boolean {
  const raw = readSessionStorageValue(PWA_AUTO_APPLY_GUARD_STORAGE_KEY)

  if (!raw) {
    return false
  }

  return (Number(raw) || 0) > now
}

export function markPwaAutoApplied(now: number = Date.now()): void {
  writeSessionStorageValue(
    PWA_AUTO_APPLY_GUARD_STORAGE_KEY,
    String(now + PWA_AUTO_APPLY_GUARD_TTL_MS),
  )
}

export interface PwaAutoApplyConditions {
  visibilityState: DocumentVisibilityState
  isChatStreaming: boolean
  hasUnsentDraft: boolean
}

// The banner's own component is only mounted while `$pwa.needRefresh` is
// true (app.vue's v-if), so that condition is already guaranteed by the
// caller and is intentionally not part of this predicate.
export function shouldAutoApplyPwaUpdate(
  conditions: PwaAutoApplyConditions,
): boolean {
  return conditions.visibilityState === 'hidden'
    && !conditions.isChatStreaming
    && !conditions.hasUnsentDraft
}
