import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '../../../../app/types/web-search'
import WebSearchTrigger from '../../../../app/components/ChatInput/WebSearchTrigger.vue'

const mocks = vi.hoisted(() => ({
  useDevice: vi.fn(),
}))

mockNuxtImport('useDevice', () => mocks.useDevice)

function useDesktopDevice() {
  mocks.useDevice.mockReturnValue({
    isIos: false,
    isAndroid: false,
    isDesktop: true,
  })
}

const options: WebSearchOption[] = [
  { value: 'web_search', label: 'Model\'s built-in search', enabled: true },
  {
    value: 'web_search_brave',
    label: 'Brave Search',
    providerId: 'brave',
    enabled: true,
  },
  {
    value: 'web_search_exa',
    label: 'Exa',
    providerId: 'exa',
    enabled: true,
  },
]

async function mountTrigger(props: {
  selected: WebSearchSelection
  align?: 'start' | 'end'
}): Promise<{ wrapper: VueWrapper, selectedProviders: WebSearchSelection[] }> {
  const selectedProviders: WebSearchSelection[] = []

  const host = defineComponent({
    setup() {
      return () => h(WebSearchTrigger, {
        selected: props.selected,
        options,
        isToolCallingSupported: true,
        align: props.align,
        onSelectProvider: (value: WebSearchSelection) => {
          selectedProviders.push(value)
        },
      })
    },
  })

  const wrapper = await mountSuspended(host, { attachTo: document.body })

  return { wrapper, selectedProviders }
}

describe('ChatInput/WebSearchTrigger', () => {
  beforeEach(() => {
    useDesktopDevice()
  })

  it('renders a ghost circle globe when nothing is selected', async () => {
    const { wrapper } = await mountTrigger({ selected: 'off' })
    const trigger = wrapper.get('[data-testid="web-search-trigger"]')

    expect(trigger.classes()).toContain('btn-circle')
    expect(trigger.text()).toBe('')
  })

  it('collapses to an active pill labelled "Search" for native search',
    async () => {
      const { wrapper } = await mountTrigger({ selected: 'web_search' })
      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.classes()).not.toContain('btn-circle')
      expect(trigger.text()).toBe('Search')
    })

  it('shows the Brave provider icon and short label when Brave is selected',
    async () => {
      const { wrapper } = await mountTrigger({ selected: 'web_search_brave' })
      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.text()).toBe('Brave')
      expect(trigger.find('.iconify').classes().join(' '))
        .toContain('simple-icons:brave')
    })

  it('shows the short label "Exa" when Exa is selected', async () => {
    const { wrapper } = await mountTrigger({ selected: 'web_search_exa' })
    const trigger = wrapper.get('[data-testid="web-search-trigger"]')

    expect(trigger.find(':scope > span:last-child').text()).toBe('Exa')
  })

  it('opens the dropdown on hover on desktop', async () => {
    const { wrapper } = await mountTrigger({ selected: 'off' })
    const details = wrapper.get('details').element as HTMLDetailsElement

    expect(details.open).toBe(false)

    await wrapper.get('details').trigger('mouseenter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(details.open).toBe(true)
  })

  it('does not open on hover on iOS', async () => {
    mocks.useDevice.mockReturnValue({
      isIos: true,
      isAndroid: false,
      isDesktop: false,
    })

    const { wrapper } = await mountTrigger({ selected: 'off' })
    const details = wrapper.get('details').element as HTMLDetailsElement

    await wrapper.get('details').trigger('mouseenter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(details.open).toBe(false)
  })

  it('force-closes on an outside click', async () => {
    const { wrapper } = await mountTrigger({ selected: 'off' })
    const details = wrapper.get('details').element as HTMLDetailsElement

    details.open = true
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(details.open).toBe(false)
  })

  it('forwards a selected option from the embedded menu items', async () => {
    const { wrapper, selectedProviders } = await mountTrigger({
      selected: 'off',
    })

    const buttons = wrapper.findAll('li > button')
    const braveButton = buttons.find((button) => {
      return button.text().includes('Brave Search')
    })

    await braveButton?.trigger('click')

    expect(selectedProviders).toEqual(['web_search_brave'])
  })

  it('aligns the dropdown to the end when align is "end"', async () => {
    const { wrapper } = await mountTrigger({ selected: 'off', align: 'end' })
    const details = wrapper.get('details')

    expect(details.classes()).toContain('dropdown-end')
  })

  it('aligns the dropdown to the start by default on narrow viewports',
    async () => {
      const { wrapper } = await mountTrigger({ selected: 'off' })
      const details = wrapper.get('details')

      expect(details.classes()).not.toContain('dropdown-end')
      expect(details.classes()).toContain('max-xs:dropdown-start')
    })
})
