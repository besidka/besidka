import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { UIMessage, SourceUrlUIPart } from 'ai'
import UrlSources from '../../../../app/components/Chat/UrlSources.vue'

const mocks = vi.hoisted(() => ({
  useUserSetting: vi.fn(),
}))

mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function createSource(
  overrides: Partial<SourceUrlUIPart> = {},
): SourceUrlUIPart {
  return {
    type: 'source-url',
    sourceId: 'source-1',
    url: 'https://www.bbc.com/news/world-europe-12345',
    ...overrides,
  } as SourceUrlUIPart
}

function mountUrlSources(parts: UIMessage['parts']) {
  return mountSuspended(UrlSources, {
    props: {
      message: createMessage(parts),
    },
  })
}

describe('Chat/UrlSources', () => {
  beforeEach(() => {
    mocks.useUserSetting.mockReturnValue({
      allowExternalLinks: shallowRef<boolean>(true),
      setAllowExternalLinks: vi.fn(),
    })
  })

  it('renders nothing when the message has no source-url parts', async () => {
    const wrapper = await mountUrlSources([
      { type: 'text', text: 'A plain reply.' },
    ])

    expect(wrapper.find('summary').exists()).toBe(false)
  })

  it('always shows the hostname, ignoring a short clean title', async () => {
    const wrapper = await mountUrlSources([
      createSource({
        url: 'https://www.bbc.com/news/world-europe-12345',
        title: 'Poland',
      }),
    ])

    expect(wrapper.text()).toContain('bbc.com')
    expect(wrapper.text()).not.toContain('Poland')
  })

  it('shows the hostname for a Brave/Exa-shaped source whose title is a '
    + 'real page title', async () => {
    const wrapper = await mountUrlSources([
      createSource({
        url: 'https://www.bbc.com/news/world-europe-67890',
        title: 'Poland - BBC News',
      }),
    ])

    expect(wrapper.text()).toContain('bbc.com')
    expect(wrapper.text()).not.toContain('Poland - BBC News')
  })

  it('strips a leading www. from the hostname', async () => {
    const wrapper = await mountUrlSources([
      createSource({ url: 'https://www.example.com/article' }),
    ])

    expect(wrapper.text()).toContain('example.com')
    expect(wrapper.text()).not.toContain('www.example.com')
  })

  it('keeps a non-www hostname as-is', async () => {
    const wrapper = await mountUrlSources([
      createSource({ url: 'https://docs.example.com/article' }),
    ])

    expect(wrapper.text()).toContain('docs.example.com')
  })

  it('falls back to the raw URL when it cannot be parsed', async () => {
    const wrapper = await mountUrlSources([
      createSource({ url: 'not-a-valid-url', title: 'Untitled' }),
    ])

    expect(wrapper.text()).toContain('not-a-valid-url')
  })

  it('renders one entry per source-url part', async () => {
    const wrapper = await mountUrlSources([
      createSource({ sourceId: 'source-1', url: 'https://a.example.com' }),
      createSource({ sourceId: 'source-2', url: 'https://b.example.com' }),
    ])

    expect(wrapper.findAll('button').length).toBe(2)
    expect(wrapper.text()).toContain('a.example.com')
    expect(wrapper.text()).toContain('b.example.com')
  })
})
