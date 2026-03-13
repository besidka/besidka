import { defineComponent, nextTick, reactive } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatsNewPage from '../../../app/pages/chats/new.vue'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

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

  afterEach(() => {
    route.query = reactive({} as Record<string, unknown>)

    replace.mockReset()
    resetMockNuxtState()
  })

  it('ignores stale folder lookups after the user selects another folder', async () => {
    const folderPickerStub = defineComponent({
      name: 'ChatInputFolderPicker',
      emits: ['submit'],
      methods: {
        open() {},
        close() {},
      },
      template: '<div />',
    })
    const folderARequest = createDeferred<{ id: string, name: string }>()
    const folderBRequest = createDeferred<{ id: string, name: string }>()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/folders/folder-a') {
        return folderARequest.promise
      }

      if (url === '/api/v1/folders/folder-b') {
        return folderBRequest.promise
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = await mountSuspended(ChatsNewPage, {
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
            props: ['folderContext'],
            template: `
              <div data-testid="folder-context">
                {{ folderContext?.id }}|{{ folderContext?.name }}
              </div>
            `,
          },
          ChatInputFolderPicker: folderPickerStub,
          LazyChatInputFolderPicker: folderPickerStub,
        },
      },
    })

    wrapper.findComponent({ name: 'ChatInputFolderPicker' }).vm.$emit(
      'submit',
      {
        folderId: 'folder-a',
        folderName: 'Folder A',
      },
    )
    await nextTick()

    expect(wrapper.get('[data-testid="folder-context"]').text()).toBe(
      'folder-a|Folder A',
    )

    wrapper.findComponent({ name: 'ChatInputFolderPicker' }).vm.$emit(
      'submit',
      {
        folderId: 'folder-b',
        folderName: 'Folder B',
      },
    )
    await nextTick()

    expect(wrapper.get('[data-testid="folder-context"]').text()).toBe(
      'folder-b|Folder B',
    )

    folderARequest.resolve({
      id: 'folder-a',
      name: 'Folder A',
    })
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.get('[data-testid="folder-context"]').text()).toBe(
      'folder-b|Folder B',
    )

    folderBRequest.resolve({
      id: 'folder-b',
      name: 'Folder B',
    })
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.get('[data-testid="folder-context"]').text()).toBe(
      'folder-b|Folder B',
    )
  })
})
