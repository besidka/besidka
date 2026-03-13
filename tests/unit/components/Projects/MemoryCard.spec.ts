import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import MemoryCard from '../../../../app/components/Projects/MemoryCard.vue'

describe('Projects/MemoryCard', () => {
  it('renders memory content and emits refresh', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        memory: 'Prefers concise implementation notes and TypeScript examples.',
        memoryStatus: 'ready',
        memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
        memoryProvider: 'google',
        memoryModel: 'gemini-2.5-flash-lite',
        memoryError: null,
        isRefreshing: false,
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
    expect(wrapper.text()).toContain('Ready')
    expect(wrapper.text()).toContain('TypeScript examples')

    await wrapper.get('[data-testid="refresh-project-memory"]').trigger('click')

    expect(wrapper.emitted('refresh')).toEqual([[]])
  })
})
