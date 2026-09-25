import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasRecentPwaAutoApply,
  markPwaAutoApplied,
  PWA_REFRESHER_DISMISS_INTERVAL_MS,
  readPwaRefresherDismissedUntil,
  shouldAutoApplyPwaUpdate,
  writePwaRefresherDismissedUntil,
} from '../../../app/composables/pwa-auto-refresh'

describe('shouldAutoApplyPwaUpdate', () => {
  it('applies when hidden, idle, and there is no unsent draft', () => {
    expect(shouldAutoApplyPwaUpdate({
      visibilityState: 'hidden',
      isChatStreaming: false,
      hasUnsentDraft: false,
    })).toBe(true)
  })

  it('never applies while the tab is visible', () => {
    expect(shouldAutoApplyPwaUpdate({
      visibilityState: 'visible',
      isChatStreaming: false,
      hasUnsentDraft: false,
    })).toBe(false)
  })

  it('does not apply while a chat is streaming', () => {
    expect(shouldAutoApplyPwaUpdate({
      visibilityState: 'hidden',
      isChatStreaming: true,
      hasUnsentDraft: false,
    })).toBe(false)
  })

  it('does not apply while there is an unsent draft', () => {
    expect(shouldAutoApplyPwaUpdate({
      visibilityState: 'hidden',
      isChatStreaming: false,
      hasUnsentDraft: true,
    })).toBe(false)
  })
})

describe('pwa refresher dismiss storage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('reads 0 when nothing was ever dismissed', () => {
    expect(readPwaRefresherDismissedUntil()).toBe(0)
  })

  it('round-trips a dismissed-until timestamp', () => {
    writePwaRefresherDismissedUntil(1234567890)

    expect(readPwaRefresherDismissedUntil()).toBe(1234567890)
  })

  it('exposes a 30-minute dismiss interval', () => {
    expect(PWA_REFRESHER_DISMISS_INTERVAL_MS).toBe(30 * 60 * 1000)
  })
})

describe('pwa auto-apply guard', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('has no recent auto-apply before one is marked', () => {
    expect(hasRecentPwaAutoApply()).toBe(false)
  })

  it('reports a recent auto-apply until the guard window elapses', () => {
    const now = 1_000_000

    markPwaAutoApplied(now)

    expect(hasRecentPwaAutoApply(now)).toBe(true)
    expect(hasRecentPwaAutoApply(now + 5 * 60 * 1000 - 1)).toBe(true)
    expect(hasRecentPwaAutoApply(now + 5 * 60 * 1000 + 1)).toBe(false)
  })
})
