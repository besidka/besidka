const DRAFT_BACKUP_KEY = 'chat_input_backup'

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

    getStorage()?.setItem(DRAFT_BACKUP_KEY, text)
  }

  function peek(): string | null {
    if (!import.meta.client) {
      return null
    }

    return getStorage()?.getItem(DRAFT_BACKUP_KEY) ?? null
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
