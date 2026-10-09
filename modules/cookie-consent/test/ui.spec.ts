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

  describe('requestConsent() while an auto-show is pending', () => {
    it('refuses and does not consume the once-per-load latch', () => {
      vi.useFakeTimers()

      const { scheduleAutoShow, cancelAutoShow, requestConsent }
        = useCookieConsentUi()

      scheduleAutoShow()

      expect(requestConsent('preferences')).toBe(false)

      cancelAutoShow()
    })
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

  describe('shouldFocusOnShow()', () => {
    it('is true after a plain openPopup() call (user-initiated default)', () => {
      const { openPopup, shouldFocusOnShow, close } = useCookieConsentUi()

      openPopup()

      expect(shouldFocusOnShow()).toBe(true)

      close()
    })

    it('is false when openPopup() is marked as not user-initiated', () => {
      const { openPopup, shouldFocusOnShow, close } = useCookieConsentUi()

      openPopup(undefined, { userInitiated: false })

      expect(shouldFocusOnShow()).toBe(false)

      close()
    })

    it('is true after a plain expand() call (user-initiated default)', () => {
      const { expand, shouldFocusOnShow, close } = useCookieConsentUi()

      expand()

      expect(shouldFocusOnShow()).toBe(true)

      close()
    })

    it('is false when expand() is marked as not user-initiated', () => {
      const { expand, shouldFocusOnShow, close } = useCookieConsentUi()

      expand({ userInitiated: false })

      expect(shouldFocusOnShow()).toBe(false)

      close()
    })

    it('flips back to true once a real user click reopens the popup', () => {
      const { openPopup, shouldFocusOnShow, close } = useCookieConsentUi()

      openPopup(undefined, { userInitiated: false })

      expect(shouldFocusOnShow()).toBe(false)

      close()

      const trigger = document.createElement('button')

      document.body.appendChild(trigger)

      openPopup(trigger)

      expect(shouldFocusOnShow()).toBe(true)

      close()
      document.body.removeChild(trigger)
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

    it(
      'does not move focus when closing a surface that was never '
      + 'user-initiated (auto-show)',
      () => {
        const elsewhere = document.createElement('input')

        document.body.appendChild(elsewhere)
        elsewhere.focus()

        const { openPopup, close } = useCookieConsentUi()

        openPopup(undefined, { userInitiated: false })

        expect(document.activeElement).toBe(elsewhere)

        close()

        expect(document.activeElement).toBe(elsewhere)

        document.body.removeChild(elsewhere)
      },
    )

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

  describe('rejectAll()', () => {
    it('commits required categories only and closes immediately', () => {
      const { granted, allowAll: allowEverything } = useCookieConsent()

      allowEverything()

      const { openPopup, rejectAll, view } = useCookieConsentUi()

      openPopup()
      rejectAll()

      expect(granted.value).toEqual(['necessary'])
      expect(view.value).toBe('hidden')
    })
  })

  describe('isCustomizing', () => {
    it('is false by default and shared across instances', () => {
      const first = useCookieConsentUi()
      const second = useCookieConsentUi()

      expect(first.isCustomizing.value).toBe(false)

      first.expand()

      expect(second.isCustomizing.value).toBe(true)

      first.close()
    })

    it('expand() defaults to customizing when user-initiated', () => {
      const { expand, isCustomizing, close } = useCookieConsentUi()

      expand()

      expect(isCustomizing.value).toBe(true)

      close()
    })

    it('expand({ userInitiated: false }) keeps the compact first layer', () => {
      const { expand, isCustomizing, view, close } = useCookieConsentUi()

      expand({ userInitiated: false })

      expect(view.value).toBe('modal')
      expect(isCustomizing.value).toBe(false)

      close()
    })

    it('close() and openPopup() reset it to false', () => {
      const { expand, openPopup, close, isCustomizing } = useCookieConsentUi()

      expand()
      close()

      expect(isCustomizing.value).toBe(false)

      expand()
      openPopup()

      expect(isCustomizing.value).toBe(false)

      close()
    })
  })

  describe('customize()', () => {
    it('reveals the detailed view of a compact modal', () => {
      const { expand, customize, isCustomizing, view, close }
        = useCookieConsentUi()

      expand({ userInitiated: false })
      customize()

      expect(view.value).toBe('modal')
      expect(isCustomizing.value).toBe(true)

      close()
    })

    it('switches the popup to the modal and starts customizing', () => {
      const { openPopup, customize, isCustomizing, view, close }
        = useCookieConsentUi()

      openPopup()
      customize()

      expect(view.value).toBe('modal')
      expect(isCustomizing.value).toBe(true)

      close()
    })

    it('opens the modal from hidden and initializes the draft', () => {
      const { customize, draft, isCustomizing, view, close }
        = useCookieConsentUi()

      customize()

      expect(view.value).toBe('modal')
      expect(isCustomizing.value).toBe(true)
      expect(draft.value).toHaveProperty('analytics')

      close()
    })
  })

  describe('expand({ trigger })', () => {
    it('restores focus to the provided trigger on close', () => {
      const trigger = document.createElement('button')

      document.body.appendChild(trigger)

      const { expand, close } = useCookieConsentUi()

      expand({ trigger })
      close()

      expect(document.activeElement).toBe(trigger)

      document.body.removeChild(trigger)
    })
  })

  describe('requestConsent()', () => {
    function resetToUndecided(): void {
      useState<boolean>('cookie-consent:decided').value = false
      useState<string[]>('cookie-consent:granted').value = ['necessary']
      useState<string | null>('cookie-consent:request').value = null
    }

    it('refuses a required category', () => {
      resetToUndecided()

      const { requestConsent, consentRequest } = useCookieConsentUi()

      expect(requestConsent('necessary')).toBe(false)
      expect(consentRequest.value).toBeNull()
    })

    it('refuses an unknown category', () => {
      resetToUndecided()

      const { requestConsent, consentRequest } = useCookieConsentUi()

      expect(requestConsent('does-not-exist')).toBe(false)
      expect(consentRequest.value).toBeNull()
    })

    it('refuses a category that is already allowed', () => {
      resetToUndecided()
      useState<string[]>('cookie-consent:granted').value
        = ['necessary', 'preferences']

      const { requestConsent, consentRequest } = useCookieConsentUi()

      expect(requestConsent('preferences')).toBe(false)
      expect(consentRequest.value).toBeNull()
    })

    it('refuses a decided visitor who rejected everything', () => {
      resetToUndecided()
      useCookieConsent().withdrawAll()

      const { requestConsent, consentRequest } = useCookieConsentUi()

      expect(requestConsent('preferences')).toBe(false)
      expect(consentRequest.value).toBeNull()
    })

    it('refuses while a consent view is open', () => {
      resetToUndecided()

      const { openPopup, expand, close, requestConsent, consentRequest }
        = useCookieConsentUi()

      openPopup()

      expect(requestConsent('preferences')).toBe(false)

      close()
      expand()

      expect(requestConsent('preferences')).toBe(false)
      expect(consentRequest.value).toBeNull()

      close()
    })

    it('opens a request for an undecided visitor and latches it', () => {
      resetToUndecided()

      const { requestConsent, consentRequest, dismissRequest }
        = useCookieConsentUi()

      expect(requestConsent('preferences')).toBe(true)
      expect(consentRequest.value).toBe('preferences')

      dismissRequest()

      expect(consentRequest.value).toBeNull()
      expect(requestConsent('preferences')).toBe(false)
      expect(consentRequest.value).toBeNull()
    })

    it('openPopup() and expand() clear an open request', () => {
      resetToUndecided()

      const request = useState<string | null>('cookie-consent:request')
      const { openPopup, expand, close } = useCookieConsentUi()

      request.value = 'preferences'
      openPopup()

      expect(request.value).toBeNull()

      close()
      request.value = 'preferences'
      expand()

      expect(request.value).toBeNull()

      close()
    })

    it('dismissRequest() clears the request without deciding', () => {
      resetToUndecided()

      const request = useState<string | null>('cookie-consent:request')
      const { isDecided } = useCookieConsent()
      const { dismissRequest } = useCookieConsentUi()

      request.value = 'preferences'
      dismissRequest()

      expect(request.value).toBeNull()
      expect(isDecided.value).toBe(false)
    })

    it('grantRequest() allows the category, keeps others, and decides', () => {
      resetToUndecided()
      useState<string[]>('cookie-consent:granted').value
        = ['necessary', 'analytics']

      const received: Array<{ granted: string[], changed: string[] }> = []
      const { onConsentChange, granted, isDecided } = useCookieConsent()
      const request = useState<string | null>('cookie-consent:request')
      const { grantRequest } = useCookieConsentUi()
      const stop = onConsentChange((payload) => {
        received.push(payload)
      })

      request.value = 'preferences'
      grantRequest('preferences')
      stop()

      expect([...granted.value].sort()).toEqual(
        ['analytics', 'necessary', 'preferences'],
      )
      expect(isDecided.value).toBe(true)
      expect(request.value).toBeNull()
      expect(received).toHaveLength(1)
      expect(received[0]?.changed).toEqual(['preferences'])
    })

    it('grantRequest() without an open request commits nothing', () => {
      resetToUndecided()

      const received: unknown[] = []
      const { onConsentChange, isDecided } = useCookieConsent()
      const { grantRequest } = useCookieConsentUi()
      const stop = onConsentChange((payload) => {
        received.push(payload)
      })

      grantRequest('preferences')
      stop()

      expect(received).toHaveLength(0)
      expect(isDecided.value).toBe(false)
    })

    it('grantRequest() for a different id commits nothing and clears the request', () => {
      resetToUndecided()

      const received: unknown[] = []
      const { onConsentChange, granted, isDecided } = useCookieConsent()
      const request = useState<string | null>('cookie-consent:request')
      const { grantRequest } = useCookieConsentUi()
      const stop = onConsentChange((payload) => {
        received.push(payload)
      })

      request.value = 'analytics'
      grantRequest('preferences')
      stop()

      expect(received).toHaveLength(0)
      expect(granted.value).not.toContain('analytics')
      expect(granted.value).not.toContain('preferences')
      expect(isDecided.value).toBe(false)
      expect(request.value).toBeNull()
    })
  })
})
