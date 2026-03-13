import { defineComponent, shallowRef } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectsPage from '../../../app/pages/chats/projects/index.vue'

describe('projects index page', () => {
  const showArchived = shallowRef<boolean>(false)
  const search = shallowRef<string>('')
  const sortBy = shallowRef<'activity' | 'name'>('activity')
  const hydrateAndRefresh = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useConfirm', vi.fn(async () => false))
    vi.stubGlobal('useProjects', () => ({
      projects: shallowRef([]),
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
      createProject: vi.fn(),
      renameProject: vi.fn(),
      togglePin: vi.fn(),
      toggleArchive: vi.fn(),
      deleteProject: vi.fn(),
    }))
  })

  afterEach(() => {
    showArchived.value = false
    search.value = ''
    sortBy.value = 'activity'
    vi.unstubAllGlobals()
  })

  it('uses radio tabs for active and archived project views', async () => {
    const projectNameModalStub = defineComponent({
      name: 'HistoryProjectNameModal',
      methods: {
        openCreate() {},
        openRename() {},
        close() {},
      },
      template: '<div />',
    })
    const wrapper = await mountSuspended(ProjectsPage, {
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
          HistoryProjectNameModal: projectNameModalStub,
          UiSearchInput: {
            template: '<input />',
          },
          HistoryProjectActionsDropdown: true,
          Icon: true,
        },
      },
    })

    const radios = wrapper.findAll('input[type="radio"][name="project_visibility"]')

    expect(radios).toHaveLength(2)
    expect(radios[0]?.attributes('aria-label')).toBe('Active')
    expect(radios[0]?.element.checked).toBe(true)
    expect(radios[1]?.attributes('aria-label')).toBe('Archived')
    expect(radios[1]?.element.checked).toBe(false)

    expect(wrapper.get('[role="radiogroup"]')
      .attributes('aria-label')).toBe('Project visibility')
  })
})
