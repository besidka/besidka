import { shallowRef } from 'vue'

// Browser-only session state: values stored here survive the session
// in-memory when the preferences category is denied, so composables
// keep working without touching real localStorage.
const pendingStorage = new Map<string, string>()

// Bumped on every real mutation (setItem, removeItem, flushPending) so
// that customRef consumers across all component instances re-evaluate.
const storageVersion = shallowRef<number>(0)

// localStorage may be missing or throw (private browsing, locked-down
// embeds, test environments) — degrade to the in-memory pending map.
function getStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch (exception) {
    void exception

    return null
  }
}

function writePersistently(
  storage: Storage,
  key: string,
  value: string,
): void {
  try {
    storage.setItem(key, value)
    pendingStorage.delete(key)
  } catch (exception) {
    void exception
    pendingStorage.set(key, value)
  }
}

function removeQuietly(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch (exception) {
    void exception
  }
}

export function requestPersistence(): void {
  if (!import.meta.client) {
    return
  }

  const isNotificationPromptVisible = useState<boolean>(
    'notification-prompt:is-visible',
    () => false,
  )

  if (isNotificationPromptVisible.value) {
    return
  }

  useCookieConsentUi().requestConsent('preferences')
}

export function usePreferenceStorage() {
  function setItem(key: string, value: string): void {
    if (!import.meta.client) {
      return
    }

    const storage = getStorage()

    if (storage && useCookieConsent().isAllowed('preferences')) {
      writePersistently(storage, key, value)
    } else {
      pendingStorage.set(key, value)
      removeQuietly(storage, key)
    }

    storageVersion.value++
  }

  function getItem(key: string): string | null {
    if (!import.meta.client) {
      return null
    }

    // Touch the version ref so customRef consumers re-evaluate after a
    // cross-instance setItem()/flushPending() mutation.
    if (storageVersion.value < 0) {
      return null
    }

    if (useCookieConsent().isAllowed('preferences')) {
      const real = getStorage()?.getItem(key) ?? null

      if (real !== null) {
        return real
      }
    }

    return pendingStorage.get(key) ?? null
  }

  function removeItem(key: string): void {
    if (!import.meta.client) {
      return
    }

    pendingStorage.delete(key)
    removeQuietly(getStorage(), key)
    storageVersion.value++
  }

  function flushPending(): void {
    if (!import.meta.client) {
      return
    }

    const storage = getStorage()

    if (!storage) {
      return
    }

    for (const [key, value] of pendingStorage) {
      writePersistently(storage, key, value)
    }

    storageVersion.value++
  }

  return {
    setItem,
    getItem,
    removeItem,
    flushPending,
  }
}
