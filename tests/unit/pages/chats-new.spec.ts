import { defineComponent, nextTick, reactive } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatsNewPage from '../../../app/pages/chats/new.vue'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

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
})
