import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import StatCard from '../../../../app/components/landing/StatCard.vue'

function makeInjectedStats(
  data: Record<string, unknown> | null,
  pending = false,
) {
  return {
    data: ref(data),
    pending: ref(pending),
  }
}

vi.stubGlobal('useLazyFetch', () => ({
  data: ref(null),
  pending: ref(false),
}))

describe('StatCard.vue', () => {
  it('renders the real value when injected stats provide it', async () => {
    const injected = makeInjectedStats({ users: 1234, chats: 56 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'users', label: 'Users' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.exists()).toBe(true)
    expect(span.text()).toBe('1.2K')
  })

  it('renders the em-dash when stats data is null (error/missing)', async () => {
    const injected = makeInjectedStats(null, false)
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'users', label: 'Users' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.exists()).toBe(true)
    expect(span.text()).toBe('—')
  })

  it('renders the em-dash when the specific metric key is absent', async () => {
    const injected = makeInjectedStats({ chats: 99 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'users', label: 'Users' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.text()).toBe('—')
  })

  it('renders a skeleton while data is still loading', async () => {
    const injected = makeInjectedStats(null, true)
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'chats', label: 'Chats' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    expect(wrapper.find('.skeleton').exists()).toBe(true)
    expect(wrapper.find('span.tabular-nums').exists()).toBe(false)
  })

  it('NEVER renders hardcoded fallback numbers (regression guard)', async () => {
    const injected = makeInjectedStats(null, false)
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'users', label: 'Users' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const html = wrapper.html()

    expect(html).not.toContain('>100<')
    expect(html).not.toContain('>1000<')
    expect(html).not.toContain('>5000<')
    expect(html).not.toContain('>1K<')
    expect(html).not.toContain('>5K<')
  })

  it('formats compact numbers correctly for chats metric', async () => {
    const injected = makeInjectedStats({ chats: 5678 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'chats', label: 'Chats', format: 'compact' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.text()).toBe('5.7K')
  })

  it('renders the sharedChats metric from injected stats', async () => {
    const injected = makeInjectedStats({ sharedChats: 50 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'sharedChats', label: 'Conversations shared' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.text()).toBe('50')
  })

  it('renders the generatedImages metric from injected stats', async () => {
    const injected = makeInjectedStats({ generatedImages: 42 })
    const wrapper = await mountSuspended(StatCard, {
      props: {
        metric: 'generatedImages',
        label: 'Images generated',
      },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.text()).toBe('42')
  })

  it('formats full numbers correctly when format is full', async () => {
    const injected = makeInjectedStats({ messages: 12345 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'messages', label: 'Messages', format: 'full' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.text()).toBe('12,345')
  })

  it('renders the label text', async () => {
    const injected = makeInjectedStats({ files: 10 })
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'files', label: 'Files uploaded' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    expect(wrapper.find('p').text()).toBe('Files uploaded')
  })

  it('sets aria-label to unavailable when value is em-dash', async () => {
    const injected = makeInjectedStats(null, false)
    const wrapper = await mountSuspended(StatCard, {
      props: { metric: 'users', label: 'Users' },
      global: {
        provide: { 'stat-grid-data': injected },
      },
    })

    const span = wrapper.find('span.tabular-nums')

    expect(span.attributes('aria-label')).toBe('Users unavailable')
  })
})
