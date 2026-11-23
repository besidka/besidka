import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'
import BesidkaRow from '../../../../../app/components/Profile/Connectors/BesidkaRow.vue'

enableAutoUnmount(afterEach)

const OPEN = '[data-testid="besidka-connector-row-open"]'
const TOGGLE = '[data-testid="besidka-connector-row-toggle"]'
const BADGE = '[data-testid="besidka-connector-row-badge"]'

async function mountRow(props: Record<string, unknown> = {}) {
  return mountSuspended(BesidkaRow, {
    props: { isActive: true, ...props },
  })
}

describe('Profile/Connectors/BesidkaRow', () => {
  it('shows the name, the description and no delete or mode controls',
    async () => {
      const wrapper = await mountRow()

      expect(wrapper.text()).toContain('Besidka')
      expect(wrapper.get('[data-testid="besidka-connector-row-description"]')
        .text().replace(/\s+/g, ' '))
        .toBe(FEATURE_REGISTRY['besidka-tools'].description)
      expect(wrapper.find('[data-testid="connector-row-remove"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="connector-row-mode"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="connector-row-status"]').exists())
        .toBe(false)
    })

  it('opens the permissions from the name while the opt-in is on', async () => {
    const wrapper = await mountRow()

    await wrapper.get(OPEN).trigger('click')

    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('shows the same Built in badge as the Google rows', async () => {
    const wrapper = await mountRow()
    const badge = wrapper.get(BADGE)

    expect(badge.text()).toBe('Built in')
    expect(badge.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-soft', 'badge-sm', 'shrink-0']),
    )
    expect(wrapper.find('[data-testid="connector-row-remove"]').exists())
      .toBe(false)
  })

  it('shows the Built in badge while the opt-in is off', async () => {
    const wrapper = await mountRow({ isActive: false })

    expect(wrapper.get(BADGE).text()).toBe('Built in')
  })

  it('has the title as the only open control and stretches it over the row',
    async () => {
      const wrapper = await mountRow()

      expect(wrapper.findAll('button, a')).toHaveLength(1)
      expect(wrapper.findAll(OPEN)).toHaveLength(1)
      expect(wrapper.classes()).toContain('relative')
      expect(wrapper.get(OPEN).classes()).toEqual(
        expect.arrayContaining([
          'after:absolute',
          'after:inset-0',
          'cursor-pointer',
        ]),
      )
    })

  it('keeps the switch above the stretched title and does not open',
    async () => {
      const wrapper = await mountRow({ isActive: false })
      const label = wrapper.get(TOGGLE).element.closest('label')!

      expect(label.classList.contains('relative')).toBe(true)
      expect(label.classList.contains('z-10')).toBe(true)

      await wrapper.get(TOGGLE).trigger('change')

      expect(wrapper.emitted('open')).toBeUndefined()
    })

  it('shows a hover state only while the opt-in is on and not selected',
    async () => {
      const active = await mountRow()
      const inactive = await mountRow({ isActive: false })
      const selected = await mountRow({ isSelected: true })

      expect(active.classes()).toContain('hover:bg-base-200/60')
      expect(inactive.classes()).not.toContain('hover:bg-base-200/60')
      expect(selected.classes()).toContain('bg-base-200')
      expect(selected.classes()).not.toContain('hover:bg-base-200/60')
    })

  it('has no open button while the opt-in is off', async () => {
    const wrapper = await mountRow({ isActive: false })

    expect(wrapper.find(OPEN).exists()).toBe(false)
    expect(wrapper.findAll('button, a')).toHaveLength(0)
    expect((wrapper.get(TOGGLE).element as HTMLInputElement).checked)
      .toBe(false)
  })

  it('emits the requested state and keeps the switch on the real state',
    async () => {
      const wrapper = await mountRow({ isActive: false })
      const toggle = wrapper.get(TOGGLE)

      ;(toggle.element as HTMLInputElement).checked = true
      await toggle.trigger('change')

      expect(wrapper.emitted('toggle')).toEqual([[true]])
      expect((toggle.element as HTMLInputElement).checked).toBe(false)
    })

  it('disables the switch while busy', async () => {
    const wrapper = await mountRow({ isBusy: true })

    expect(wrapper.get(TOGGLE).attributes('disabled')).toBeDefined()
    expect(wrapper.get(TOGGLE).attributes('aria-busy')).toBe('true')
  })

  it('is not busy by default', async () => {
    const wrapper = await mountRow()

    expect(wrapper.get(TOGGLE).attributes('aria-busy')).toBe('false')
  })

  it('marks itself selected while its panel is open', async () => {
    const wrapper = await mountRow({ isSelected: true })

    expect(wrapper.classes()).toContain('bg-base-200')
  })
})
