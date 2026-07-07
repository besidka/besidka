import { shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SharedChatPage from '../../../../app/pages/shared/[slug].vue'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../../setup/helpers/nuxt-state'

const routeParams = { slug: 'shared-slug-1' }
const sharedChatResponse = shallowRef<Record<string, unknown> | null>(null)
const sharedChatError = shallowRef<unknown>(null)

mockNuxtImport('useRoute', () => {
  return () => ({ params: routeParams })
})

mockNuxtImport('useFetch', () => {
  return () => ({
    data: sharedChatResponse,
    error: sharedChatError,
  })
})

mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: shallowRef(null),
    execute: vi.fn(async () => undefined),
  })
})

function createSharedChatFixture(
  messages: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    title: 'Shared chat',
    indexable: false,
    showFiles: true,
    showMetadata: false,
    showAuthorAvatar: false,
    allowBranch: false,
    author: null,
    messages,
  }
}

const pageStubs = {
  ChatContainer: {
    template: '<div><slot /></div>',
  },
  UiBubble: {
    template: '<div><slot /></div>',
  },
  UiButton: {
    template: '<button><slot /></button>',
  },
  ChatFiles: {
    props: ['message'],
    template: '<div />',
  },
  MDCCached: {
    template: '<div />',
  },
  ChatMessage: {
    props: [
      'role',
      'messageId',
      'isSelected',
      'anySelected',
      'authorName',
      'authorImage',
    ],
    template: '<div><slot /></div>',
  },
}

describe('shared chat page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null

  beforeEach(() => {
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    vi.stubGlobal('useHead', vi.fn())
    routeParams.slug = 'shared-slug-1'
    sharedChatResponse.value = null
    sharedChatError.value = null

    // `mockReset: true` (vitest.config.mts) resets every vi.fn() before each
    // test, including the shared matchMedia mock vitest.setup.ts installs
    // once for the whole suite — reapply its implementation here rather
    // than in the global setup, since only this page's onMounted
    // (isExternalBrowserContext -> matchMedia) exercises it synchronously.
    ;(window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation(
      (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    )
  })

  afterEach(async () => {
    wrapper?.unmount()
    wrapper = null

    resetMockNuxtState()
    vi.unstubAllGlobals()
  })

  it('renders ChatDeepResearchProgress (not standalone reasoning) for a research turn', async () => {
    sharedChatResponse.value = createSharedChatFixture([
      {
        id: 'msg-research',
        role: 'assistant',
        parts: [
          {
            type: 'data-research-brief',
            data: {
              topic: 'ai policy trends',
              depth: 'thorough',
              answers: [],
            },
          },
          {
            type: 'data-research-step',
            id: 'research-step-planning',
            data: {
              phase: 'planning',
              label: 'Planning the research',
              status: 'done',
              detail: 'Breaking the question into sub-topics.',
            },
          },
          { type: 'text', text: 'Final report body.' },
        ],
        reasoning: 'off',
        researchDepth: 'thorough',
      },
    ])

    wrapper = await mountSuspended(SharedChatPage, {
      global: { stubs: pageStubs },
    })

    expect(wrapper.text()).toContain('Deep research')
    expect(wrapper.text()).toContain('thorough')
    expect(wrapper.text()).not.toContain('Reasoning process')
  })

  it('renders ChatReasoning and ChatUrlSources for a non-research turn', async () => {
    sharedChatResponse.value = createSharedChatFixture([
      {
        id: 'msg-plain',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Thinking about the plain question.' },
          { type: 'text', text: 'Here is the answer.' },
          {
            type: 'source-url',
            sourceId: 'src-1',
            url: 'https://example.com/a',
            title: 'Example A',
          },
        ],
        reasoning: 'medium',
        researchDepth: null,
      },
    ])

    wrapper = await mountSuspended(SharedChatPage, {
      global: { stubs: pageStubs },
    })

    expect(wrapper.text()).toContain('Reasoning process')
    expect(wrapper.text()).toContain('Sources')
    expect(wrapper.text()).not.toContain('Deep research')
  })

  it('renders both a research and a non-research message carrying the researchDepth field without errors', async () => {
    sharedChatResponse.value = createSharedChatFixture([
      {
        id: 'msg-research',
        role: 'assistant',
        parts: [
          {
            type: 'data-research-brief',
            data: {
              topic: 'renewable energy adoption',
              depth: 'quick',
              answers: [],
            },
          },
          {
            type: 'data-research-step',
            id: 'research-step-planning',
            data: {
              phase: 'planning',
              label: 'Planning the research',
              status: 'done',
              detail: 'Breaking the question into sub-topics.',
            },
          },
        ],
        reasoning: 'off',
        researchDepth: 'quick',
      },
      {
        id: 'msg-plain',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'A plain follow-up answer.' },
        ],
        reasoning: 'off',
        researchDepth: null,
      },
    ])

    wrapper = await mountSuspended(SharedChatPage, {
      global: { stubs: pageStubs },
    })

    expect(wrapper.find('[data-testid="shared-not-found"]').exists())
      .toBe(false)
    expect(wrapper.text()).toContain('Deep research')
  })
})
