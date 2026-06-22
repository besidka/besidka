import { defineComponent, nextTick, reactive } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    },
    emits: ['submit', 'update:message'],
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

    expect(storage.getItem('chat_input_backup')).toBe('unsent message')
    expect(navigateToMock).toHaveBeenCalledWith('/signin')
    expect(chatInput.props('message')).toBe('unsent message')
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
    storage.setItem('chat_input_backup', 'recovered after relaunch')

    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('$fetch', vi.fn())

    const { chatInputStub, stubs } = createSendStubs()

    wrapper = await mountSuspended(ChatsNewPage, { global: { stubs } })
    await nextTick()

    expect(
      wrapper.findComponent(chatInputStub).props('message'),
    ).toBe('recovered after relaunch')
  })
})
