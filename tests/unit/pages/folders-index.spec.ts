import { defineComponent, shallowRef } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FoldersPage from '../../../app/pages/chats/folders/index.vue'

describe('folders index page', () => {
  const showArchived = shallowRef<boolean>(false)
  const search = shallowRef<string>('')
  const sortBy = shallowRef<'activity' | 'name'>('activity')
  const hydrateAndRefresh = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useConfirm', vi.fn(async () => false))
    vi.stubGlobal('useFolders', () => ({
      folders: shallowRef([]),
      pinned: shallowRef([]),
      search,
      sortBy,
      showArchived,
      isLoadingInitial: shallowRef(false),
      isSearching: shallowRef(false),
      isCreating: shallowRef(false),
      hasCachedData: shallowRef(true),
      prime: vi.fn(),
      hydrateAndRefresh,
      createFolder: vi.fn(),
      renameFolder: vi.fn(),
      togglePin: vi.fn(),
      toggleArchive: vi.fn(),
      deleteFolder: vi.fn(),
    }))
  })

  afterEach(() => {
    showArchived.value = false
    search.value = ''
    sortBy.value = 'activity'
    vi.unstubAllGlobals()
  })

  it('uses radio tabs for active and archived folder views', async () => {
    const folderNameModalStub = defineComponent({
      name: 'HistoryFolderNameModal',
      methods: {
        openCreate() {},
        openRename() {},
        close() {},
      },
      template: '<div />',
    })
    const wrapper = await mountSuspended(FoldersPage, {
      global: {
        stubs: {
          HistoryPageShell: {
            template: `
              <div>
                <slot name="toolbar" />
                <slot name="secondary-tabs" />
                <slot />
              </div>
            `,
          },
          HistoryFolderNameModal: folderNameModalStub,
          UiSearchInput: {
            template: '<input />',
          },
          HistoryFolderActionsDropdown: true,
          Icon: true,
        },
      },
    })

    const radios = wrapper.findAll('input[type="radio"][name="folder_visibility"]')

    expect(radios).toHaveLength(2)
    expect(radios[0]?.attributes('aria-label')).toBe('Active')
    expect(radios[0]?.element.checked).toBe(true)
    expect(radios[1]?.attributes('aria-label')).toBe('Archived')
    expect(radios[1]?.element.checked).toBe(false)

    expect(wrapper.get('[role="radiogroup"]')
      .attributes('aria-label')).toBe('Folder visibility')
  })
})
