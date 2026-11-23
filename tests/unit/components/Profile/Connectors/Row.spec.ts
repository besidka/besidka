import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import Row from '../../../../../app/components/Profile/Connectors/Row.vue'
import { createConnectorItem } from '../../../../setup/helpers/connectors-ui'
import type { ConnectorPageItem } from '#shared/types/connectors.d'

enableAutoUnmount(afterEach)

const OPEN = '[data-testid="connector-row-open"]'
const TOGGLE = '[data-testid="connector-row-toggle"]'
const CONNECT = '[data-testid="connector-row-connect"]'
const REMOVE = '[data-testid="connector-row-remove"]'
const REVIEW = '[data-testid="connector-row-review"]'

const STRETCHED_TITLE_CLASSES = [
  'after:absolute',
  'after:inset-0',
  'cursor-pointer',
]

async function mountRow(
  connector: ConnectorPageItem,
  props: Record<string, unknown> = {},
) {
  return mountSuspended(Row, { props: { connector, ...props } })
}

describe('Profile/Connectors/Row', () => {
  it('opens the panel from the title and emits the connector', async () => {
    const connector = createConnectorItem({ enabled: true })
    const wrapper = await mountRow(connector)

    await wrapper.get(OPEN).trigger('click')

    expect(wrapper.emitted('open')).toEqual([[connector]])
  })

  it('has the title as the only open control and stretches it over the row',
    async () => {
      const wrapper = await mountRow(createConnectorItem({ enabled: true }))
      const controls = wrapper.findAll('button, a')

      expect(wrapper.findAll(OPEN)).toHaveLength(1)
      expect(controls).toHaveLength(1)
      expect(wrapper.classes()).toContain('relative')
      expect(wrapper.get(OPEN).classes())
        .toEqual(expect.arrayContaining(STRETCHED_TITLE_CLASSES))
      expect(wrapper.find('button button, a button, button a').exists())
        .toBe(false)
    })

  it('keeps the toggle above the stretched title and does not open',
    async () => {
      const wrapper = await mountRow(createConnectorItem({ enabled: true }))
      const toggle = wrapper.get(TOGGLE)
      const label = toggle.element.closest('label')!

      expect(label.classList.contains('z-10')).toBe(true)
      expect(label.classList.contains('relative')).toBe(true)

      ;(toggle.element as HTMLInputElement).checked = false
      await toggle.trigger('change')

      expect(wrapper.emitted('toggle')).toHaveLength(1)
      expect(wrapper.emitted('open')).toBeUndefined()
    })

  it('keeps Connect and Remove above the stretched title', async () => {
    const connector = createConnectorItem({
      status: 'needs-auth',
      lastConnectedAt: null,
      consent: { state: 'current', issuerHost: null, givenAt: null },
    })
    const wrapper = await mountRow(connector)

    expect(wrapper.get(CONNECT).classes())
      .toEqual(expect.arrayContaining(['relative', 'z-10']))
    expect(wrapper.get(REMOVE).classes())
      .toEqual(expect.arrayContaining(['relative', 'z-10']))

    await wrapper.get(CONNECT).trigger('click')
    await wrapper.get(REMOVE).trigger('click')

    expect(wrapper.emitted('connect')).toEqual([[connector]])
    expect(wrapper.emitted('remove')).toEqual([[connector]])
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('keeps Review above the stretched title and opens the panel',
    async () => {
      const connector = createConnectorItem({ status: 'drifted' })
      const wrapper = await mountRow(connector)

      expect(wrapper.get(REVIEW).classes())
        .toEqual(expect.arrayContaining(['relative', 'z-10']))

      await wrapper.get(REVIEW).trigger('click')

      expect(wrapper.emitted('open')).toEqual([[connector]])
    })

  it('shows a hover state until the row is selected', async () => {
    const connector = createConnectorItem({ enabled: true })
    const idle = await mountRow(connector)
    const selected = await mountRow(connector, { isSelected: true })

    expect(idle.classes()).toContain('hover:bg-base-200/60')
    expect(idle.classes()).not.toContain('bg-base-200')
    expect(selected.classes()).toContain('bg-base-200')
    expect(selected.classes()).not.toContain('hover:bg-base-200/60')
  })
})
