import { defineComponent, nextTick, reactive } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../app/composables/messages'
import ChatsNewPage from '../../../app/pages/chats/new.vue'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}))

mockNuxtImport('navigateTo', () => navigateToMock)

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function createStorageShim() {
  const entries = new Map<string, string>()

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    clear: () => {
      entries.clear()
    },
  }
}

function createSendStubs() {
  const chatInputStub = defineComponent({
    name: 'ChatInputStub',
    props: {
      message: {
        type: String,
        default: '',
      },
      files: {
        type: Array,
        default: () => [],
      },
    },
    emits: ['submit', 'update:message', 'update:files'],
    template: '<div data-testid="chat-input-message">{{ message }}</div>',
  })
  const projectPickerStub = defineComponent({
    name: 'ChatInputProjectPicker',
    emits: ['submit'],
    methods: {
      open() {},
      close() {},
    },
    template: '<div />',
  })

  const stubs = {
    ChatContainer: {
      template: '<div><slot /></div>',
    },
    ChatProjectInstructions: {
      props: ['instructions', 'memory'],
      template: '<div />',
    },
    ChatMessage: {
      template: '<div><slot /></div>',
    },
    LazyBackgroundLogo: true,
    ChatInput: chatInputStub,
    ChatInputProjectPicker: projectPickerStub,
    LazyChatInputProjectPicker: projectPickerStub,
  }

  return {
    chatInputStub,
    stubs,
  }
}

function createResearchStubs() {
  const { chatInputStub, stubs } = createSendStubs()
  const clarifyStub = defineComponent({
    name: 'ChatDeepResearchClarify',
    props: ['clarification', 'loading'],
    emits: ['submit', 'skip'],
    template: '<div data-testid="clarify-stub" />',
  })
  const pendingStub = defineComponent({
    name: 'ChatDeepResearchPending',
    props: ['job', 'elapsedMs'],
    template: `
      <div data-testid="pending-stub">{{ job?.status }}|{{ job?.modelId }}</div>
    `,
  })

  return {
    chatInputStub,
    clarifyStub,
    pendingStub,
    stubs: {
      ...stubs,
      ChatDeepResearchClarify: clarifyStub,
      ChatDeepResearchPending: pendingStub,
    },
  }
}

describe('chats new page', () => {
  const route = reactive({
    query: reactive({} as Record<string, unknown>),
  })
  const replace = vi.fn()
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null

  beforeEach(() => {
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({
      replace,
    }))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useLocalStorage', <T>(_: string, value: T) => {
      return shallowRef<T>(value)
    })
    vi.stubGlobal('normalizeReasoningLevel', (value: string) => value)
    vi.stubGlobal('getFileUrl', vi.fn())
  })

  afterEach(async () => {
    wrapper?.unmount()
    wrapper = null

    await nextTick()
    await flushPromises()

    route.query = reactive({} as Record<string, unknown>)

    replace.mockReset()
    resetMockNuxtState()
    vi.unstubAllGlobals()
  })

  it('ignores stale project lookups after the user selects another project', async () => {
    const projectPickerStub = defineComponent({
      name: 'ChatInputProjectPicker',
      emits: ['submit'],
      methods: {
        open() {},
        close() {},
      },
      template: '<div />',
    })
    const projectARequest = createDeferred<{ id: string, name: string }>()
    const projectBRequest = createDeferred<{ id: string, name: string }>()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/projects/project-a') {
        return projectARequest.promise
      }

      if (url === '/api/v1/projects/project-b') {
        return projectBRequest.promise
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    wrapper = await mountSuspended(ChatsNewPage, {
      global: {
        stubs: {
          ChatContainer: {
            template: '<div><slot /></div>',
          },
          ChatProjectInstructions: {
            props: ['instructions', 'memory'],
            template: `
              <div data-testid="project-instructions">
                {{ instructions || '' }}|{{ memory || '' }}
              </div>
            `,
          },
          ChatMessage: {
            template: '<div><slot /></div>',
          },
          LazyBackgroundLogo: true,
          ChatInput: {
            props: ['projectContext'],
            template: `
              <div data-testid="project-context">
                {{ projectContext?.id }}|{{ projectContext?.name }}
              </div>
            `,
          },
          ChatInputProjectPicker: projectPickerStub,
          LazyChatInputProjectPicker: projectPickerStub,
        },
      },
    })

    wrapper.findComponent({ name: 'ChatInputProjectPicker' }).vm.$emit(
      'submit',
      {
        projectId: 'project-a',
        projectName: 'Project A',
      },
    )
    await nextTick()

    expect(wrapper.get('[data-testid="project-context"]').text()).toBe(
      'project-a|Project A',
    )

    wrapper.findComponent({ name: 'ChatInputProjectPicker' }).vm.$emit(
      'submit',
      {
        projectId: 'project-b',
        projectName: 'Project B',
      },
    )
    await nextTick()

    expect(wrapper.get('[data-testid="project-context"]').text()).toBe(
      'project-b|Project B',
    )

    projectARequest.resolve({
      id: 'project-a',
      name: 'Project A',
    })
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.get('[data-testid="project-context"]').text()).toBe(
      'project-b|Project B',
    )

    projectBRequest.resolve({
      id: 'project-b',
      name: 'Project B',
    })
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.get('[data-testid="project-context"]').text()).toBe(
      'project-b|Project B',
    )
  })

  it('shows project instructions and memory after selecting a project', async () => {
    const projectPickerStub = defineComponent({
      name: 'ChatInputProjectPicker',
      emits: ['submit'],
      methods: {
        open() {},
        close() {},
      },
      template: '<div />',
    })

    vi.stubGlobal('$fetch', vi.fn(async () => ({
      id: 'project-a',
      name: 'Project A',
      instructions: 'Stay focused on milestones',
      memory: 'User prefers concise updates.',
      memoryStatus: 'ready',
    })))

    wrapper = await mountSuspended(ChatsNewPage, {
      global: {
        stubs: {
          ChatContainer: {
            template: '<div><slot /></div>',
          },
          ChatProjectInstructions: {
            props: ['instructions', 'memory'],
            template: `
              <div data-testid="project-instructions">
                {{ instructions || '' }}|{{ memory || '' }}
              </div>
            `,
          },
          ChatMessage: {
            template: '<div><slot /></div>',
          },
          LazyBackgroundLogo: true,
          ChatInput: {
            props: ['projectContext'],
            template: `
              <div data-testid="project-context">
                {{ projectContext?.id }}|{{ projectContext?.name }}
              </div>
            `,
          },
          ChatInputProjectPicker: projectPickerStub,
          LazyChatInputProjectPicker: projectPickerStub,
        },
      },
    })

    expect(
      wrapper.find('[data-testid="project-instructions"]').exists(),
    ).toBe(false)

    wrapper.findComponent({ name: 'ChatInputProjectPicker' }).vm.$emit(
      'submit',
      {
        projectId: 'project-a',
        projectName: 'Project A',
      },
    )
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-testid="project-context"]').text()).toBe(
      'project-a|Project A',
    )
    expect(wrapper.get('[data-testid="project-instructions"]').text()).toBe(
      'Stay focused on milestones|User prefers concise updates.',
    )
  })

  it('backs up the draft and redirects to /signin on a dead-session 401', async () => {
    // createAuthClient is mocked so getSession() resolves { data: null }; the
    // cache-bypassing recovery therefore finds no session and must redirect.
    const storage = createStorageShim()

    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()
    vi.stubGlobal('$fetch', vi.fn(() => {
      return Promise.reject(
        Object.assign(new Error('No access'), {
          statusCode: 401,
          status: 401,
        }),
      )
    }))

    const { chatInputStub, stubs } = createSendStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'unsent message')
    await nextTick()

    chatInput.vm.$emit('submit')
    // ChatInput clears the textarea optimistically right after emitting submit.
    chatInput.vm.$emit('update:message', '')
    await flushPromises()
    await nextTick()
    await flushPromises()

    const storedBackup = storage.getItem('chat_input_backup')

    expect(storedBackup).not.toBeNull()
    expect(JSON.parse(storedBackup as string).text).toBe('unsent message')
    expect(navigateToMock).toHaveBeenCalledWith('/signin')
    expect(chatInput.props('message')).toBe('unsent message')
  })

  it('restores attached files on a failed send', async () => {
    const storage = createStorageShim()

    const fetchMock = vi.fn(() => {
      return Promise.reject(
        Object.assign(new Error('Server error'), {
          statusCode: 500,
          status: 500,
        }),
      )
    })

    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()
    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, stubs } = createSendStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)
    const attached = [
      { name: 'report.pdf', type: 'application/pdf', storageKey: 'k1' },
    ]

    chatInput.vm.$emit('update:message', 'see attached')
    chatInput.vm.$emit('update:files', attached)
    await nextTick()

    chatInput.vm.$emit('submit')
    // ChatInput clears BOTH the textarea and the files optimistically.
    chatInput.vm.$emit('update:message', '')
    chatInput.vm.$emit('update:files', [])
    await flushPromises()
    await nextTick()
    await flushPromises()

    // The outgoing request carries the snapshot, not the optimistically
    // cleared live files.
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as {
      parts: { type: string }[]
    }

    expect(sentBody.parts.some(part => part.type === 'file')).toBe(true)
    // The input and its attachments are restored after the failed send.
    expect(chatInput.props('message')).toBe('see attached')
    expect(chatInput.props('files')).toEqual(attached)
  })

  it('clears the draft backup after a successful send', async () => {
    const storage = createStorageShim()

    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()
    vi.stubGlobal('$fetch', vi.fn(() => {
      return Promise.resolve({ slug: 'created-chat' })
    }))

    const { chatInputStub, stubs } = createSendStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'hello there')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/chats/created-chat')
    expect(storage.getItem('chat_input_backup')).toBeNull()
  })

  it('restores a backed-up draft on mount', async () => {
    const storage = createStorageShim()

    storage.setItem('chat_input', '')
    storage.setItem(
      'chat_input_backup',
      JSON.stringify({
        text: 'recovered after relaunch',
        savedAt: Date.now(),
      }),
    )

    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('$fetch', vi.fn())

    const { chatInputStub, stubs } = createSendStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })
    await nextTick()

    expect(
      wrapper.findComponent(chatInputStub).props('message'),
    ).toBe('recovered after relaunch')
  })

  it('routes into the clarify flow and starts research with the answers', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({
          questions: [],
          note: 'Scope check',
        })
      }

      if (url === '/api/v1/chats/new') {
        return Promise.resolve({ slug: 'research-chat' })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, clarifyStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    const clarifyComponent = wrapper.findComponent(clarifyStub)

    expect(clarifyComponent.exists()).toBe(true)
    expect(clarifyComponent.props('clarification')).toEqual({
      questions: [],
      note: 'Scope check',
    })

    clarifyComponent.vm.$emit('submit', [
      { id: 'audience', question: 'Who is this for?', answer: 'Engineers' },
    ])
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/chats/research-chat')

    const createCall = fetchMock.mock.calls.find(([url]) => {
      return url === '/api/v1/chats/new'
    })
    const createCallOptions = createCall?.[1] as {
      body: { model: string, research: { answers: unknown[] } }
    } | undefined

    expect(createCallOptions?.body.model).toBe('o4-mini-deep-research')
    expect(createCallOptions?.body.research).toEqual({
      answers: [
        {
          id: 'audience',
          question: 'Who is this for?',
          answer: 'Engineers',
        },
      ],
    })
  })

  it('shows a synthetic pending research block while the create request is in flight', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()

    const createRequest = createDeferred<{ slug: string }>()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({ questions: [] })
      }

      if (url === '/api/v1/chats/new') {
        return createRequest.promise
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, clarifyStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    const clarifyComponent = wrapper.findComponent(clarifyStub)

    clarifyComponent.vm.$emit('submit', [])
    await nextTick()

    // The greeting and the clarify form must not reappear while the PUT
    // that creates the chat is still in flight (issue #1: 10-15s dead air).
    expect(wrapper.text()).not.toContain('How can I assist you today?')
    expect(wrapper.find('[data-testid="clarify-stub"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="research-clarify-topic"]').text())
      .toBe('Research topic')

    const pendingStub = wrapper.get('[data-testid="pending-stub"]')

    expect(pendingStub.text()).toBe('pending|o4-mini-deep-research')

    createRequest.resolve({ slug: 'research-chat' })
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/chats/research-chat')
  })

  it('spaces the topic bubble and clarify form using only the container gap', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({ questions: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    // ChatContainer applies a gap between its direct children by default, so
    // the topic bubble and clarify form must not also carry their own mt-3 —
    // that would double the gap between them relative to two normal message
    // bubbles.
    expect(
      wrapper.get('[data-testid="research-clarify-topic"]').classes(),
    ).not.toContain('mt-3')
    expect(
      wrapper.get('[data-testid="clarify-stub"]').classes(),
    ).not.toContain('mt-3')
  })

  it('reserves clarify-input clearance at every breakpoint, sized to the input height plus a margin', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({ questions: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    await useNuxtApp().callHook('chat-input:height', 140)
    await nextTick()

    const spacer = wrapper.get('[data-testid="clarify-input-spacer"]')

    // Reserved height must clear the fixed ChatInput's own height (140) plus
    // a small margin (12, matching INITIAL_SPACER_PADDING) — and, unlike the
    // mobile-only spacer this replaced, it must not be gated to a breakpoint,
    // since a long clarify form can outgrow the viewport on desktop too.
    expect(spacer.attributes('style')).toContain('152px')
    expect(spacer.classes()).not.toContain('hidden')
    expect(spacer.classes()).not.toContain('max-sm:block')
  })

  it('clears the pending research block and restores the draft on a failed create request', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({ questions: [] })
      }

      if (url === '/api/v1/chats/new') {
        return Promise.reject(
          Object.assign(new Error('Server error'), {
            statusCode: 500,
            status: 500,
          }),
        )
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, clarifyStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    const clarifyComponent = wrapper.findComponent(clarifyStub)

    clarifyComponent.vm.$emit('submit', [])
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-testid="pending-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="research-clarify-topic"]').exists())
      .toBe(false)
    expect(wrapper.text()).toContain('How can I assist you today?')
    expect(chatInput.props('message')).toBe('Research topic')
  })

  it('falls back to starting research with no answers when the clarify request fails', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o3-deep-research')
    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.reject(new Error('clarify unavailable'))
      }

      if (url === '/api/v1/chats/new') {
        return Promise.resolve({ slug: 'fallback-chat' })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/chats/fallback-chat')

    const createCall = fetchMock.mock.calls.find(([url]) => {
      return url === '/api/v1/chats/new'
    })
    const createCallOptions = createCall?.[1] as {
      body: { model: string, research: { answers: unknown[] } }
    } | undefined

    expect(createCallOptions?.body.model).toBe('o3-deep-research')
    expect(createCallOptions?.body.research).toEqual({
      answers: [],
    })
  })

  it('still navigates and shows a toast when starting research returns a soft failure', async () => {
    const storage = createStorageShim()

    storage.setItem('model', 'o4-mini-deep-research')
    vi.stubGlobal('localStorage', storage)
    navigateToMock.mockClear()

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return Promise.resolve({ questions: [] })
      }

      if (url === '/api/v1/chats/new') {
        return Promise.resolve({
          slug: 'research-chat',
          researchError: {
            message: 'Could not start the research job.',
            why: 'The research provider rejected the request.',
          },
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const { chatInputStub, clarifyStub, stubs } = createResearchStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })

    const chatInput = wrapper.findComponent(chatInputStub)

    chatInput.vm.$emit('update:message', 'Research topic')
    await nextTick()

    chatInput.vm.$emit('submit')
    await flushPromises()
    await nextTick()
    await flushPromises()

    const clarifyComponent = wrapper.findComponent(clarifyStub)

    clarifyComponent.vm.$emit('submit', [])
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/chats/research-chat')
    expect(useErrorMessage).toHaveBeenCalledWith(
      'Could not start the research job.',
      'The research provider rejected the request.',
    )
    expect(storage.getItem('chat_input_backup')).toBeNull()
  })
})
