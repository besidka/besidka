import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import StatGrid from '../../../../app/components/landing/StatGrid.vue'

vi.stubGlobal('useLazyFetch', () => ({
  data: ref({
    users: 10,
    chats: 20,
    messages: 30,
    files: 40,
    sharedChats: 50,
  }),
  pending: ref(false),
}))

const FIVE_METRICS = [
  { metric: 'users', label: 'Users' },
  { metric: 'chats', label: 'Chats' },
  { metric: 'messages', label: 'Messages' },
  { metric: 'files', label: 'Files' },
  { metric: 'sharedChats', label: 'Conversations shared' },
] as const

describe('StatGrid.vue', () => {
  it('renders one card per metric including sharedChats', async () => {
    const wrapper = await mountSuspended(StatGrid, {
      props: { metrics: [...FIVE_METRICS] },
    })

    const labels = wrapper.findAll('p').map((paragraph) => {
      return paragraph.text()
    })

    expect(labels).toEqual([
      'Users',
      'Chats',
      'Messages',
      'Files',
      'Conversations shared',
    ])
  })

  it('keeps a single row on md+ via column-flow auto placement', async () => {
    const wrapper = await mountSuspended(StatGrid, {
      props: { metrics: [...FIVE_METRICS] },
    })

    const grid = wrapper.find('div.grid')

    expect(grid.classes()).toContain('md:grid-flow-col')
    expect(grid.classes()).toContain('md:auto-cols-fr')
    expect(grid.classes()).toContain('grid-cols-2')
  })

  it('makes the last card full-width below md when count is odd', async () => {
    const wrapper = await mountSuspended(StatGrid, {
      props: { metrics: [...FIVE_METRICS] },
    })

    const cards = wrapper.findAll('.rounded-2xl')

    expect(cards).toHaveLength(5)
    expect(cards[4]?.classes()).toContain('max-md:col-span-2')
    expect(cards[3]?.classes()).not.toContain('max-md:col-span-2')
  })

  it('does not stretch the last card when count is even', async () => {
    const wrapper = await mountSuspended(StatGrid, {
      props: { metrics: [...FIVE_METRICS.slice(0, 4)] },
    })

    const cards = wrapper.findAll('.rounded-2xl')

    expect(cards).toHaveLength(4)
    expect(cards[3]?.classes()).not.toContain('max-md:col-span-2')
  })
})
