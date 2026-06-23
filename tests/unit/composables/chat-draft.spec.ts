import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatDraftBackup } from '../../../app/composables/chat-draft'

/**
 * The draft backup deliberately bypasses the cookie-consent 'preferences'
 * gate (a user's own unsent message is functional/necessary data) and writes
 * straight to localStorage so it survives a failed send, a /signin redirect,
 * and a PWA relaunch. Node 26 / the nuxt test env may not provide a real
 * localStorage, so a minimal shim is stubbed in.
 */
function createStorageShim() {
  const entries = new Map<string, string>()

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    clear: () => {
      entries.clear()
    },
  }
}

describe('useChatDraftBackup', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageShim())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves a draft and restores it verbatim', () => {
    const backup = useChatDraftBackup()

    backup.save('  keep my\nwhitespace  ')

    expect(backup.peek()).toBe('  keep my\nwhitespace  ')
  })

  it('rejects a blank-only draft', () => {
    const backup = useChatDraftBackup()

    backup.save('   \n  \t ')

    expect(backup.peek()).toBeNull()
  })

  it('clears the backup', () => {
    const backup = useChatDraftBackup()

    backup.save('draft to clear')
    backup.clear()

    expect(backup.peek()).toBeNull()
  })

  it('persists across instances, surviving a redirect or relaunch', () => {
    useChatDraftBackup().save('survives navigation')

    // A fresh composable instance models the page mounting again after a
    // /signin round-trip or a PWA relaunch.
    expect(useChatDraftBackup().peek()).toBe('survives navigation')
  })

  it('degrades gracefully when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)

    const backup = useChatDraftBackup()

    expect(() => backup.save('x')).not.toThrow()
    expect(backup.peek()).toBeNull()
    expect(() => backup.clear()).not.toThrow()
  })

  it('discards an expired draft and prunes the entry', () => {
    const expired = Date.now() - 48 * 60 * 60 * 1000

    window.localStorage.setItem(
      'chat_input_backup',
      JSON.stringify({ text: 'stale draft', savedAt: expired }),
    )

    const backup = useChatDraftBackup()

    expect(backup.peek()).toBeNull()
    expect(window.localStorage.getItem('chat_input_backup')).toBeNull()
  })

  it('discards a corrupt or legacy plain-string value', () => {
    window.localStorage.setItem('chat_input_backup', 'legacy-plain-string')

    const backup = useChatDraftBackup()

    expect(backup.peek()).toBeNull()
    expect(window.localStorage.getItem('chat_input_backup')).toBeNull()
  })

  it('does not throw when localStorage access throws (private mode)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })

    try {
      const backup = useChatDraftBackup()

      expect(() => backup.save('x')).not.toThrow()
      expect(() => backup.peek()).not.toThrow()
      expect(backup.peek()).toBeNull()
      expect(() => backup.clear()).not.toThrow()
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original)
      }
    }
  })
})
