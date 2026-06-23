const DRAFT_BACKUP_KEY = 'chat_input_backup'

// Bound how long an unsent draft can resurrect: long enough to recover after a
// failed send plus a /signin re-login or a PWA relaunch, short enough that a
// draft the user abandoned does not silently reappear on a much later visit.
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

interface DraftBackup {
  text: string
  savedAt: number
}

// A user's own unsent message is functional/necessary data, so the backup is
// written straight to localStorage — deliberately NOT gated behind the
// 'preferences' consent category like `chat_input` is. It survives an
// optimistic clear, a failed send, a /signin redirect, and a PWA relaunch so
// the draft can be restored when the user returns to /chats/new.
export function useChatDraftBackup() {
  function getStorage(): Storage | null {
    try {
      return window.localStorage ?? null
    } catch {
      return null
    }
  }

  function save(text: string): void {
    if (!import.meta.client) {
      return
    }

    // Reject blank-only drafts, but persist the original text verbatim so the
    // user's exact input (including intentional leading/trailing newlines) is
    // restored unchanged.
    if (!text.trim()) {
      return
    }

    const payload: DraftBackup = {
      text,
      savedAt: Date.now(),
    }

    getStorage()?.setItem(DRAFT_BACKUP_KEY, JSON.stringify(payload))
  }

  function peek(): string | null {
    if (!import.meta.client) {
      return null
    }

    const storage = getStorage()
    const raw = storage?.getItem(DRAFT_BACKUP_KEY)

    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as Partial<DraftBackup>
      const text = typeof parsed.text === 'string' ? parsed.text : null
      const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0

      // Discard a draft with no text, a missing/zero timestamp, or one past
      // the TTL, so an abandoned message cannot resurrect on a later visit.
      if (!text || Date.now() - savedAt > DRAFT_TTL_MS) {
        storage?.removeItem(DRAFT_BACKUP_KEY)

        return null
      }

      return text
    } catch {
      // Corrupt or legacy plain-string value — drop it.
      storage?.removeItem(DRAFT_BACKUP_KEY)

      return null
    }
  }

  function clear(): void {
    if (!import.meta.client) {
      return
    }

    getStorage()?.removeItem(DRAFT_BACKUP_KEY)
  }

  return {
    save,
    peek,
    clear,
  }
}
