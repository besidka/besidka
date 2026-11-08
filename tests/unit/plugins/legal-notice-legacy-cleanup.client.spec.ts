import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import plugin from '../../../app/plugins/legal-notice-legacy-cleanup.client'

const LEGACY_KEY = 'legal-notice:dismissed:42:2026-11-legal-notices'

describe('legal-notice-legacy-cleanup plugin', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  function runPlugin() {
    const run = plugin as unknown as () => void

    run()
  }

  it('removes the legacy dismissal keys on load', () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    window.localStorage.setItem('chat_input_backup', '{}')

    runPlugin()

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(window.localStorage.getItem('chat_input_backup')).toBe('{}')
  })

  it('never reads the legacy values', () => {
    window.localStorage.setItem(LEGACY_KEY, '1')

    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    runPlugin()

    expect(getItem).not.toHaveBeenCalled()
  })

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('blocked')
    })
    window.localStorage.setItem(LEGACY_KEY, '1')

    expect(runPlugin).not.toThrow()
  })
})
