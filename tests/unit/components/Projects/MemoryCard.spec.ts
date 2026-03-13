import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import MemoryCard from '../../../../app/components/Projects/MemoryCard.vue'

describe('Projects/MemoryCard', () => {
  it('renders ready memory without a ready badge and emits refresh', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        memory: 'Prefers concise implementation notes and TypeScript examples.',
        memoryStatus: 'ready',
        memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
        memoryProvider: 'google',
        memoryModel: 'gemini-2.5-flash-lite',
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Project memory')
    expect(wrapper.text()).toContain('TypeScript examples')
    expect(wrapper.text()).toContain('Disable memory')
    expect(wrapper.text()).not.toContain('Ready')

    await wrapper.get('[data-testid="refresh-project-memory"]').trigger('click')

    expect(wrapper.emitted('refresh')).toEqual([[]])
  })

  it('renders disabled state with enable action', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        memory: null,
        memoryStatus: 'disabled',
        memoryUpdatedAt: null,
        memoryProvider: null,
        memoryModel: null,
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Disabled')
    expect(wrapper.text()).toContain(
      'Project memory is disabled for this project.',
    )
    expect(wrapper.text()).toContain('Enable memory')
    expect(wrapper.find('[data-testid="refresh-project-memory"]').exists()).toBe(false)

    await wrapper.get('[data-testid="toggle-project-memory"]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[]])
  })

  it('renders empty state guidance for instruction-only projects', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        memory: null,
        memoryStatus: 'idle',
        memoryUpdatedAt: null,
        memoryProvider: 'google',
        memoryModel: 'gemini-3.1-flash-lite-preview',
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Empty')
    expect(wrapper.text()).toContain(
      'No reusable project memory was found.',
    )
    expect(wrapper.text()).toContain('keeping memory disabled is often better')
    expect(wrapper.text()).not.toContain('Model: google')
  })
})
