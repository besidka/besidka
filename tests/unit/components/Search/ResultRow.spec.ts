import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
