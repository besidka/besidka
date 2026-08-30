import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import HistoryChatRow from '../../../../app/components/History/ChatRow.vue'
import { createHistoryChat } from '../../../setup/helpers/history-fixtures'

function mountChatRow(chat: ReturnType<typeof createHistoryChat>) {
  return mountSuspended(HistoryChatRow, {
    props: {
      chat,
      isSelectionMode: false,
      isSelected: false,
      index: 0,
    },
    global: {
      stubs: {
        Icon: true,
        HistoryActionsDropdown: true,
      },
    },
  })
}

describe('History/ChatRow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders a snippet with highlighted segments when the chat has one', async () => {
    const wrapper = await mountChatRow(createHistoryChat({
      snippet: `before ${SNIPPET_START}highlighted${SNIPPET_END} after`,
    }))

    const snippet = wrapper.find('[data-testid="chat-row-snippet"]')

    expect(snippet.exists()).toBe(true)
    expect(snippet.text()).toBe('before highlighted after')

    const highlighted = snippet.find('mark')

    expect(highlighted.exists()).toBe(true)
    expect(highlighted.text()).toBe('highlighted')
  })

  it('never injects a snippet as raw HTML (no v-html XSS hole)', async () => {
    const maliciousText = '<img src=x onerror=alert(1)>'
    const wrapper = await mountChatRow(createHistoryChat({
      snippet: `${SNIPPET_START}${maliciousText}${SNIPPET_END}`,
    }))

    const snippet = wrapper.find('[data-testid="chat-row-snippet"]')

    expect(snippet.text()).toBe(maliciousText)
    expect(snippet.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('<img')
  })

  it('renders no snippet element when the chat has no snippet', async () => {
    const wrapper = await mountChatRow(createHistoryChat({ snippet: null }))

    expect(wrapper.find('[data-testid="chat-row-snippet"]').exists())
      .toBe(false)
  })

  it('shows the "In messages" badge only when matchedIn is content', async () => {
    const contentMatch = await mountChatRow(createHistoryChat({
      matchedIn: 'content',
    }))

    expect(contentMatch.find('[data-testid="chat-content-match-badge"]')
      .exists()).toBe(true)
    expect(contentMatch.text()).toContain('In messages')

    const noMatch = await mountChatRow(createHistoryChat())

    expect(noMatch.find('[data-testid="chat-content-match-badge"]').exists())
      .toBe(false)
  })
})
