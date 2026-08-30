import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import SearchResultRow from '../../../../app/components/Search/ResultRow.vue'
import { createHistoryChat } from '../../../setup/helpers/history-fixtures'

describe('Search/ResultRow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the chat title and formatted activity age', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ title: 'Quarterly report', shared: false }),
        active: false,
      },
    })

    expect(wrapper.text()).toContain('Quarterly report')
    expect(wrapper.text()).toContain('Last activity 2 hours ago')
  })

  it('falls back to "Untitled Chat" when the title is empty', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ title: '', shared: false }),
        active: false,
      },
    })

    expect(wrapper.text()).toContain('Untitled Chat')
  })

  it('shows the project badge when the chat belongs to a project', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({
          projectName: 'Research',
          shared: false,
        }),
        active: false,
      },
    })

    expect(wrapper.text()).toContain('Research')
  })

  it('hides both badges when there is no project and it is not shared', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ projectName: null, shared: false }),
        active: false,
      },
    })

    expect(wrapper.find('.badge').exists()).toBe(false)
  })

  it('shows the shared badge with the expected testid when shared', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: true }),
        active: false,
      },
    })

    expect(wrapper.find('[data-testid="chat-shared-badge"]').exists())
      .toBe(true)
  })

  it('hides the shared badge when the chat is not shared', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: false }),
        active: false,
      },
    })

    expect(wrapper.find('[data-testid="chat-shared-badge"]').exists())
      .toBe(false)
  })

  it('applies the active highlight class when active', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: false }),
        active: true,
      },
    })

    expect(wrapper.classes()).toContain('bg-base-content/10')
    expect(wrapper.classes()).not.toContain('hover:bg-base-content/5')
  })

  it('applies the hover class when inactive', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: false }),
        active: false,
      },
    })

    expect(wrapper.classes()).toContain('hover:bg-base-content/5')
    expect(wrapper.classes()).not.toContain('bg-base-content/10')
  })

  it('emits select when clicked', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: false }),
        active: false,
      },
    })

    await wrapper.trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('renders a snippet as separate text/mark segments through normal interpolation', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({
          snippet: `before ${SNIPPET_START}highlighted${SNIPPET_END} after`,
          shared: false,
        }),
        active: false,
      },
    })

    const snippet = wrapper.find('[data-testid="chat-row-snippet"]')

    expect(snippet.exists()).toBe(true)
    expect(snippet.text()).toBe('before highlighted after')

    const highlighted = snippet.find('mark')

    expect(highlighted.exists()).toBe(true)
    expect(highlighted.text()).toBe('highlighted')
  })

  it('never injects a snippet as raw HTML (no v-html XSS hole)', async () => {
    const maliciousText = '<img src=x onerror=alert(1)>'
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({
          snippet: `${SNIPPET_START}${maliciousText}${SNIPPET_END}`,
          shared: false,
        }),
        active: false,
      },
    })

    const snippet = wrapper.find('[data-testid="chat-row-snippet"]')

    expect(snippet.text()).toBe(maliciousText)
    expect(snippet.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('<img')
  })

  it('renders no snippet element when the chat has no snippet', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ snippet: null, shared: false }),
        active: false,
      },
    })

    expect(wrapper.find('[data-testid="chat-row-snippet"]').exists())
      .toBe(false)
  })

  it('shows the "In messages" badge only when matchedIn is content', async () => {
    const contentMatch = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ matchedIn: 'content', shared: false }),
        active: false,
      },
    })

    expect(contentMatch.find('[data-testid="chat-content-match-badge"]')
      .exists()).toBe(true)
    expect(contentMatch.text()).toContain('In messages')

    const titleMatch = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ matchedIn: 'title', shared: false }),
        active: false,
      },
    })

    expect(titleMatch.find('[data-testid="chat-content-match-badge"]')
      .exists()).toBe(false)
  })

  it('shows the pin badge only when pinnedAt is set', async () => {
    const pinned = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({
          pinnedAt: '2026-03-01T00:00:00.000Z',
          shared: false,
        }),
        active: false,
      },
    })

    expect(pinned.find('[data-testid="chat-pinned-badge"]').exists())
      .toBe(true)

    const unpinned = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ pinnedAt: null, shared: false }),
        active: false,
      },
    })

    expect(unpinned.find('[data-testid="chat-pinned-badge"]').exists())
      .toBe(false)
  })

  it('has a single root element so parent-assigned attrs fall through', async () => {
    const wrapper = await mountSuspended(SearchResultRow, {
      props: {
        chat: createHistoryChat({ shared: false }),
        active: false,
      },
      attrs: {
        'id': 'search-option-chat-1',
        'role': 'option',
        'aria-selected': 'true',
      },
    })

    expect(wrapper.attributes('id')).toBe('search-option-chat-1')
    expect(wrapper.attributes('role')).toBe('option')
    expect(wrapper.attributes('aria-selected')).toBe('true')
    expect(wrapper.attributes('data-testid')).toBe('search-result-row')
  })
})
