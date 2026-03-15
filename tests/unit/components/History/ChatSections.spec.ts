import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import HistoryChatSections from '../../../../app/components/History/ChatSections.vue'
import {
  createHistoryChat,
} from '../../../setup/helpers/history-fixtures'

describe('HistoryChatSections', () => {
  it('renders pinned chats separately from grouped chats', async () => {
    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'))

    const wrapper = await mountSuspended(HistoryChatSections, {
      props: {
        pinned: [
          createHistoryChat({
            id: 'chat-pinned',
            title: 'Pinned chat',
            pinnedAt: '2026-03-11T08:00:00.000Z',
          }),
        ],
        chats: [
          createHistoryChat({
            id: 'chat-today',
            title: 'Today chat',
            activityAt: '2026-03-11T09:00:00.000Z',
          }),
          createHistoryChat({
            id: 'chat-older',
            title: 'Older chat',
            activityAt: '2026-02-10T09:00:00.000Z',
          }),
        ],
        groupedAt: '2026-03-11T12:00:00.000Z',
        isLoadingInitial: false,
        isSelectionMode: false,
        emptyStateMode: 'history',
      },
      global: {
        stubs: {
          HistoryChatRow: {
            props: ['chat'],
            template: '<li>{{ chat.title }}</li>',
          },
          Icon: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Pinned')
    expect(wrapper.text()).toContain('Today')
    expect(wrapper.text()).toContain('February 2026')
    expect(wrapper.text()).toContain('Pinned chat')
    expect(wrapper.text()).toContain('Today chat')
    expect(wrapper.text()).toContain('Older chat')
  })

  it('renders search empty state when no chats match', async () => {
    const wrapper = await mountSuspended(HistoryChatSections, {
      props: {
        pinned: [],
        chats: [],
        isLoadingInitial: false,
        isSelectionMode: false,
        emptyStateMode: 'search',
      },
      global: {
        stubs: {
          Icon: true,
        },
      },
    })

    expect(wrapper.text()).toContain('No chats match your search')
    expect(wrapper.text()).toContain('Try a different title.')
  })
})
