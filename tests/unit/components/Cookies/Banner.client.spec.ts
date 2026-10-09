import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'
import Banner from '../../../../app/components/Cookies/Banner.client.vue'
import {
  useCookieConsent,
} from '../../../../modules/cookie-consent/src/runtime/composables/consent'
import {
  useCookieConsentUi,
} from '../../../../modules/cookie-consent/src/runtime/composables/ui'

function resetToUndecided(): void {
  const decided = useState<boolean>('cookie-consent:decided')
  const granted = useState<string[]>('cookie-consent:granted')

  decided.value = false
  granted.value = ['necessary']
}

/**
 * Sequential lifecycle tests — one Nuxt app per file, state persists across
 * tests. Order matters: undecided → decided (necessary only) → decided
 * (preferences granted). Drives the real module composables; the module
 * runtime is never mocked (dual module graph). The test setup pre-grants all
 * categories, so the first describe resets the shared state to undecided.
 */
describe('Cookies/Banner.client (sequential lifecycle)', () => {
  beforeAll(() => {
    resetToUndecided()
  })

  describe('undecided', () => {
    it('popup offers Reject all and Accept all with identical classes', async () => {
      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.openPopup()
      await nextTick()

      const popup = wrapper.get('[data-testid="cookies-popup"]')
      const rejectClass = popup
        .get('[data-testid="cookies-reject-all"]')
        .attributes('class')
      const acceptClass = popup
        .get('[data-testid="cookies-allow-all"]')
        .attributes('class')

      expect(rejectClass).toBe(acceptClass)
      expect(popup.find('[data-testid="cookies-withdraw"]').exists())
        .toBe(false)
      expect(popup.find('[data-testid="cookies-change"]').exists())
        .toBe(true)
      expect(popup.find('[data-testid="cookies-policy-link"]').exists())
        .toBe(true)
      expect(popup.find('[data-testid="cookies-state-necessary"]').exists())
        .toBe(false)

      ui.close()
      wrapper.unmount()
    })

    it('modal opens on a compact first layer until customize is clicked', async () => {
      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.expand({ userInitiated: false })
      await nextTick()

      const modal = wrapper.get('[data-testid="cookies-modal"]')

      expect(modal.find('[data-testid="cookies-first-layer"]').exists())
        .toBe(true)
      expect(modal.find('[data-testid="cookies-toggle-preferences"]').exists())
        .toBe(false)
      expect(modal.find('[data-testid="cookies-reject-all"]').exists())
        .toBe(true)
      expect(modal.find('[data-testid="cookies-withdraw"]').exists())
        .toBe(false)

      await modal.get('[data-testid="cookies-change"]').trigger('click')

      expect(modal.find('[data-testid="cookies-first-layer"]').exists())
        .toBe(false)
      expect(modal.find('[data-testid="cookies-toggle-preferences"]').exists())
        .toBe(true)
      expect(modal.find('[data-testid="cookies-reject-all"]').exists())
        .toBe(true)
      expect(modal.find('[data-testid="cookies-withdraw"]').exists())
        .toBe(false)

      ui.close()
      wrapper.unmount()
    })
  })

  describe('undecided, compact modal', () => {
    it('moves focus to the heading once the categories replace the first layer', async () => {
      const wrapper = await mountSuspended(Banner, {
        attachTo: document.body,
      })
      const ui = useCookieConsentUi()

      ui.expand({ userInitiated: false })
      await nextTick()

      const modal = wrapper.get('[data-testid="cookies-modal"]')

      await modal.get('[data-testid="cookies-change"]').trigger('click')
      await nextTick()

      expect(document.activeElement?.tagName).toBe('H2')
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
      expect(modal.element.contains(document.activeElement)).toBe(true)

      ui.close()
      wrapper.unmount()
    })

    it('labels the categories footer accept button Accept all', async () => {
      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.expand()
      await nextTick()

      expect(
        wrapper.get('[data-testid="cookies-allow-all"]').text(),
      ).toContain('cookieConsent.actions.acceptAll')

      ui.close()
      wrapper.unmount()
    })
  })

  describe('decided with only necessary categories granted', () => {
    it('popup has no withdraw button', async () => {
      useCookieConsent().withdrawAll()

      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.openPopup()
      await nextTick()

      const popup = wrapper.get('[data-testid="cookies-popup"]')

      expect(popup.find('[data-testid="cookies-state-necessary"]').exists())
        .toBe(true)
      expect(popup.find('[data-testid="cookies-withdraw"]').exists())
        .toBe(false)
      expect(popup.find('[data-testid="cookies-change"]').exists())
        .toBe(true)

      ui.close()
      wrapper.unmount()
    })

    it('modal footer shows Reject all instead of withdraw', async () => {
      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.expand()
      await nextTick()

      const modal = wrapper.get('[data-testid="cookies-modal"]')

      expect(modal.find('[data-testid="cookies-first-layer"]').exists())
        .toBe(false)
      expect(modal.find('[data-testid="cookies-reject-all"]').exists())
        .toBe(true)
      expect(modal.find('[data-testid="cookies-withdraw"]').exists())
        .toBe(false)

      ui.close()
      wrapper.unmount()
    })
  })

  describe('decided with preferences granted', () => {
    it('popup shows the withdraw button', async () => {
      useCookieConsent().allow(['preferences'])

      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.openPopup()
      await nextTick()

      const popup = wrapper.get('[data-testid="cookies-popup"]')

      const withdrawClass = popup
        .get('[data-testid="cookies-withdraw"]')
        .attributes('class')
      const changeClass = popup
        .get('[data-testid="cookies-change"]')
        .attributes('class')

      expect(withdrawClass).toBe(changeClass)
      expect(withdrawClass).not.toContain('btn-ghost')
      expect(withdrawClass).not.toContain('order')

      ui.close()
      wrapper.unmount()
    })

    it('modal footer shows withdraw in the reject position', async () => {
      const wrapper = await mountSuspended(Banner)
      const ui = useCookieConsentUi()

      ui.expand()
      await nextTick()

      const modal = wrapper.get('[data-testid="cookies-modal"]')
      const withdrawClass = modal
        .get('[data-testid="cookies-withdraw"]')
        .attributes('class')
      const acceptClass = modal
        .get('[data-testid="cookies-allow-all"]')
        .attributes('class')

      expect(modal.find('[data-testid="cookies-reject-all"]').exists())
        .toBe(false)
      expect(withdrawClass).toBe(acceptClass)

      ui.close()
      wrapper.unmount()
    })
  })
})
