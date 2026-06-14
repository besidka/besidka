import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useCookieConsent,
} from '../src/runtime/composables/consent'
import {
  useCookieConsentUi,
} from '../src/runtime/composables/ui'

/**
 * Runs against the real Nuxt test environment (real useState, useCookie
 * and hooks) — one app per file, so state persists across tests and the
 * suite reads as one sequential UI session. Test order matters; the
 * scheduleAutoShow tests must come first because the once-per-boot guard
 * is module-scope and flips on the first call.
 */
describe('useCookieConsentUi (sequential session)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('scheduleAutoShow()', () => {
    it('opens the popup after the configured delay when undecided', () => {
      vi.useFakeTimers()

      const { scheduleAutoShow, view } = useCookieConsentUi()

      scheduleAutoShow()

      expect(view.value).toBe('hidden')

      vi.advanceTimersByTime(5000)

      expect(view.value).toBe('popup')

      useCookieConsentUi().close()
    })

    it('is a no-op on subsequent calls (once-per-boot guard)', () => {
      vi.useFakeTimers()

      const { scheduleAutoShow, view } = useCookieConsentUi()

      scheduleAutoShow()
      vi.advanceTimersByTime(5000)

      expect(view.value).toBe('hidden')
    })
  })

  describe('shared state across instances', () => {
    it('draft and view changes in one instance reach another', () => {
      const first = useCookieConsentUi()
      const second = useCookieConsentUi()

      first.openPopup()
      first.toggleDraft('analytics')

      expect(second.draft.value['analytics']).toBe(true)
      expect(second.view.value).toBe('popup')

      first.close()
    })
  })

  describe('toggleDraft()', () => {
    it('toggles optional categories and ignores required ones', () => {
      const { openPopup, toggleDraft, draft, close } = useCookieConsentUi()

      openPopup()
      toggleDraft('analytics')
      toggleDraft('necessary')

      expect(draft.value['analytics']).toBe(true)
      expect(draft.value['necessary']).toBe(true)

      close()
    })
  })

  describe('draft lifecycle', () => {
    it('expand preserves popup draft toggles', () => {
      const { openPopup, toggleDraft, expand, draft, view, close }
        = useCookieConsentUi()

      openPopup()
      toggleDraft('analytics')

      const snapshot = { ...draft.value }

      expand()

      expect(view.value).toBe('modal')
      expect(draft.value).toEqual(snapshot)

      close()
    })

    it('expand from hidden initializes the draft', () => {
      const { expand, view, draft, close } = useCookieConsentUi()

      expand()

      expect(view.value).toBe('modal')
      expect(draft.value).toHaveProperty('analytics')

      close()
    })
  })

  describe('commit actions', () => {
    it('commitDraft commits enabled ids and closes immediately', () => {
      const received: Array<{ granted: string[] }> = []
      const { onConsentChange } = useCookieConsent()
      const { openPopup, toggleDraft, commitDraft, view }
        = useCookieConsentUi()

      const stop = onConsentChange((payload) => {
        received.push(payload)
      })

      openPopup()
      toggleDraft('analytics')
      commitDraft()
      stop()

      expect(received[0]?.granted).toEqual(
        expect.arrayContaining(['necessary', 'analytics']),
      )
      expect(view.value).toBe('hidden')
    })

    it('ui.allowAll commits every category and closes immediately', () => {
      const { granted, categories } = useCookieConsent()
      const { openPopup, allowAll, view } = useCookieConsentUi()

      openPopup()
      allowAll()

      const allIds = categories.map((category) => {
        return category.id
      })

      expect([...granted.value].sort()).toEqual([...allIds].sort())
      expect(view.value).toBe('hidden')
    })

    it('ui.withdrawAll commits required only and closes immediately', () => {
      const { granted } = useCookieConsent()
      const { openPopup, withdrawAll, view } = useCookieConsentUi()

      openPopup()
      withdrawAll()

      expect(granted.value).toEqual(['necessary'])
      expect(view.value).toBe('hidden')
    })

    it('openPopup initializes the draft from committed consent', () => {
      const { allow } = useCookieConsent()

      allow(['analytics'])

      const { openPopup, draft, close } = useCookieConsentUi()

      openPopup()

      expect(draft.value['necessary']).toBe(true)
      expect(draft.value['analytics']).toBe(true)
      expect(draft.value['preferences']).toBe(false)

      close()
    })
  })

  describe('close()', () => {
    it('hides the view and discards the draft', () => {
      const { openPopup, toggleDraft, close, draft, view }
        = useCookieConsentUi()

      openPopup()
      toggleDraft('preferences')
      close()

      expect(view.value).toBe('hidden')
      expect(draft.value).toEqual({})
    })

    it('restores focus to the trigger element that opened the popup', () => {
      const trigger = document.createElement('button')

      document.body.appendChild(trigger)
      trigger.focus()

      const { openPopup, close } = useCookieConsentUi()

      openPopup(trigger)
      close()

      expect(document.activeElement).toBe(trigger)

      document.body.removeChild(trigger)
    })

    it('does not throw when the trigger left the document', () => {
      const trigger = document.createElement('button')

      document.body.appendChild(trigger)

      const { openPopup, close } = useCookieConsentUi()

      openPopup(trigger)
      document.body.removeChild(trigger)

      expect(() => close()).not.toThrow()
    })
  })

  describe('isTriggerNode()', () => {
    it('returns true for the stored trigger element and its descendants', () => {
      const trigger = document.createElement('button')
      const child = document.createElement('span')

      trigger.appendChild(child)
      document.body.appendChild(trigger)

      const { openPopup, close, isTriggerNode } = useCookieConsentUi()

      openPopup(trigger)

      expect(isTriggerNode(trigger)).toBe(true)
      expect(isTriggerNode(child)).toBe(true)

      close()
      document.body.removeChild(trigger)
    })

    it('returns false for document.body as the stored trigger', () => {
      const { openPopup, close, isTriggerNode } = useCookieConsentUi()

      openPopup(document.body as unknown as HTMLElement)

      expect(isTriggerNode(document.body)).toBe(false)

      close()
    })

    it('returns false for an unrelated node', () => {
      const trigger = document.createElement('button')
      const other = document.createElement('div')

      document.body.appendChild(trigger)
      document.body.appendChild(other)

      const { openPopup, close, isTriggerNode } = useCookieConsentUi()

      openPopup(trigger)

      expect(isTriggerNode(other)).toBe(false)

      close()
      document.body.removeChild(trigger)
      document.body.removeChild(other)
    })
  })

  describe('switchProps()', () => {
    it('marks required categories as disabled and checked', () => {
      const { openPopup, switchProps, close } = useCookieConsentUi()

      openPopup()

      const props = switchProps('necessary')

      expect(props.role).toBe('switch')
      expect(props.disabled).toBe(true)
      expect(props['aria-checked']).toBe(true)

      close()
    })

    it('mirrors the draft state for optional categories', () => {
      const { openPopup, toggleDraft, switchProps, close }
        = useCookieConsentUi()

      openPopup()

      const before = switchProps('marketing')['aria-checked']

      toggleDraft('marketing')

      expect(switchProps('marketing')['aria-checked']).toBe(!before)
      expect(switchProps('marketing').disabled).toBe(false)

      close()
    })
  })
})
