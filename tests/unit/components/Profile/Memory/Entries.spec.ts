import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, shallowRef, toValue } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AboutMeNotMigratedReason,
  MemoryCategory,
  MemoryEntry,
  MemorySettingsFields,
} from '../../../../../shared/types/memory.d'
import type { MemoryEntriesResponse } from '../../../../../shared/types/memory-api.d'
import Entries from '../../../../../app/components/Profile/Memory/Entries.vue'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  fetch: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const ENTRIES_URL = '/api/v1/memory/entries'

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

const DetailModalStub = defineComponent({
  props: ['open', 'entry', 'limits', 'projectId', 'takenSingletonCategories'],
  emits: ['update:open', 'changed'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'detail-modal-stub',
      'data-open': String(props.open),
      'data-entry-id': props.entry?.id ?? '',
      'data-project-id': props.projectId ?? '',
    }, [
      h('button', {
        'data-testid': 'detail-modal-changed',
        'onClick': () => emit('changed', {
          reason: 'saved',
          categoryChanged: false,
        }),
      }),
      h('button', {
        'data-testid': 'detail-modal-category-changed',
        'onClick': () => emit('changed', {
          reason: 'saved',
          categoryChanged: true,
        }),
      }),
      h('button', {
        'data-testid': 'detail-modal-created',
        'onClick': () => emit('changed', {
          reason: 'created',
          categoryChanged: false,
        }),
      }),
      h('button', {
        'data-testid': 'detail-modal-deleted',
        'onClick': () => emit('changed', {
          reason: 'deleted',
          categoryChanged: false,
        }),
      }),
    ])
  },
})

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

interface TestProject {
  id: string
  name: string
  memoryStatus: string
}

const defaultProjects: TestProject[] = [
  { id: 'project-1', name: 'Home lab', memoryStatus: 'ready' },
  { id: 'project-2', name: 'Side project', memoryStatus: 'disabled' },
  { id: 'project-3', name: 'Quiet project', memoryStatus: 'idle' },
]

const entriesData = shallowRef<MemoryEntriesResponse | null>(null)
const projectsData = shallowRef<{
  pinned: TestProject[]
  projects: TestProject[]
  nextCursor: null
} | null>(null)
const projectsPending = shallowRef<boolean>(false)
const projectsError = shallowRef<unknown>(null)
const projectsRefresh = vi.fn()
const archivedProjectsData = shallowRef<{
  pinned: TestProject[]
  projects: TestProject[]
  nextCursor: null
} | null>(null)
const archivedProjectsError = shallowRef<unknown>(null)
const archivedProjectsRefresh = vi.fn()
const entriesPending = shallowRef<boolean>(false)
const entriesError = shallowRef<unknown>(null)
const refresh = vi.fn()

function createEntry(
  id: string,
  category: MemoryCategory,
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id,
    projectId: null,
    category,
    slug: id,
    title: `Title ${id}`,
    description: `Description ${id}`,
    body: 'Body',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'tool',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
    ...overrides,
  }
}

function createResponse(
  groups: MemoryEntriesResponse['groups'],
  overrides: Partial<MemoryEntriesResponse> = {},
): MemoryEntriesResponse {
  return {
    scope: 'all',
    projectId: null,
    total: groups.reduce((sum, group) => sum + group.entries.length, 0),
    limits: {
      maxAccountEntries: 30,
      maxProjectEntries: 15,
      maxBodyBytes: 2048,
      maxAlwaysInjectedBodyBytes: 1024,
      maxDescriptionChars: 100,
      maxTitleChars: 80,
    },
    groups,
    ...overrides,
  }
}

async function mountEntries(
  settings: Partial<MemorySettingsFields> = {},
  route = '/',
  aboutMeNotMigratedReason: AboutMeNotMigratedReason | null = null,
  slots: Record<string, () => unknown> = {},
) {
  const wrapper = await mountSuspended(Entries, {
    route,
    attachTo: document.body,
    props: {
      settings: { ...defaultSettings, ...settings },
      aboutMeNotMigratedReason,
    },
    slots,
    global: {
      stubs: {
        NuxtLink: nuxtLinkStub,
        LazyProfileMemoryEntriesDetailModal: DetailModalStub,
        ProfileMemoryEntriesDetailModal: DetailModalStub,
      },
    },
  })

  await flushPromises()

  return wrapper
}

function entriesOptions() {
  const calls = mocks.useLazyFetch.mock.calls.filter(([url]) => {
    return url === ENTRIES_URL
  })

  return calls.at(-1)![1] as {
    key: unknown
    query: unknown
  }
}

describe('Profile/Memory/Entries', () => {
  beforeEach(() => {
    entriesData.value = createResponse([])
    projectsData.value = {
      pinned: [],
      projects: defaultProjects,
      nextCursor: null,
    }
    projectsPending.value = false
    projectsError.value = null
    projectsRefresh.mockReset()
    archivedProjectsData.value = { pinned: [], projects: [], nextCursor: null }
    archivedProjectsError.value = null
    archivedProjectsRefresh.mockReset()
    entriesPending.value = false
    entriesError.value = null
    refresh.mockReset()
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.info.mockReset()
    mocks.error.mockReset()
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockImplementation((
      url: string,
      options: { query: { archived?: boolean } },
    ) => {
      if (url === ENTRIES_URL) {
        return {
          data: entriesData,
          pending: entriesPending,
          error: entriesError,
          refresh,
        }
      }

      if (options.query.archived) {
        return {
          data: archivedProjectsData,
          pending: projectsPending,
          error: archivedProjectsError,
          refresh: archivedProjectsRefresh,
        }
      }

      return {
        data: projectsData,
        pending: projectsPending,
        error: projectsError,
        refresh: projectsRefresh,
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the section heading and description', async () => {
    const wrapper = await mountEntries()
    const section = wrapper.get('[data-testid="memory-entries-section"]')

    expect(section.text()).toContain('What Besidka remembers')
    expect(section.text()).toContain(
      'Everything Besidka keeps about you, grouped by category. '
      + 'Add, edit or delete anything.',
    )
  })

  describe('list', () => {
    it('puts profile and preferences under You, then topics, areas, people',
      async () => {
        entriesData.value = createResponse([
          { category: 'topics', entries: [createEntry('t1', 'topics')] },
          { category: 'people', entries: [createEntry('o1', 'people')] },
          { category: 'areas', entries: [createEntry('a1', 'areas')] },
          {
            category: 'preferences',
            entries: [createEntry('f1', 'preferences')],
          },
          {
            category: 'profile',
            entries: [createEntry('p1', 'profile')],
          },
        ])

        const wrapper = await mountEntries()
        const list = wrapper.get('[data-testid="memory-entries-list"]')
        const essentials = list.get('[data-testid="memory-entry-essentials"]')
        const groups = wrapper.findAll('[data-testid="memory-entry-group"]')

        expect(essentials.get('h3 > span').text()).toBe('You')
        expect(essentials.findAll('[data-testid="memory-entry-label"]')
          .map(label => label.text())).toEqual(['Profile', 'Preferences'])
        expect(groups.map(group => group.attributes('data-category')))
          .toEqual(['topics', 'areas', 'people'])
        expect(groups.map(group => group.get('h3 > span').text()))
          .toEqual(['Topics', 'Areas', 'People'])

        const orderedTitles = list.findAll('[data-testid="memory-entry-row"]')
          .map(row => row.text())

        expect(orderedTitles).toEqual([
          expect.stringContaining('Title p1'),
          expect.stringContaining('Title f1'),
          expect.stringContaining('Title t1'),
          expect.stringContaining('Title a1'),
          expect.stringContaining('Title o1'),
        ])
      })

    it('renders one continuous list ending with the Projects section',
      async () => {
        entriesData.value = createResponse([
          { category: 'profile', entries: [createEntry('p1', 'profile')] },
          {
            category: 'people',
            entries: [
              createEntry('o1', 'people'),
              createEntry('o2', 'people', { projectId: 'project-1' }),
            ],
          },
        ])

        const wrapper = await mountEntries()
        const headings = wrapper
          .findAll('[data-testid="memory-entries-list"] section > h3')
          .map(heading => heading.get('span').text())

        expect(headings).toEqual(['You', 'People', 'Projects'])
        expect(wrapper.findAll(
          '[data-testid="memory-entries-list"] > section, '
          + '[data-testid="memory-entries-list"] > div > section',
        )).toHaveLength(3)
      })

    it('shows a call to action in an empty You group', async () => {
      entriesData.value = createResponse([
        { category: 'topics', entries: [createEntry('t1', 'topics')] },
      ])

      const wrapper = await mountEntries()
      const cta = wrapper.get('[data-testid="memory-entry-essentials-empty"]')

      expect(wrapper.get('[data-testid="memory-entry-essentials-heading"]')
        .text()).toBe('You')
      expect(cta.text()).toContain('Tell Besidka about yourself')

      await wrapper.get('[data-testid="memory-essentials-add"]')
        .trigger('click')

      const modal = wrapper.getComponent(DetailModalStub)

      expect(modal.attributes('data-open')).toBe('true')
      expect(modal.attributes('data-entry-id')).toBe('')
      expect(modal.attributes('data-project-id')).toBe('')
    })

    it('shows title, description and updated on each row', async () => {
      entriesData.value = createResponse([
        {
          category: 'preferences',
          entries: [createEntry('f1', 'preferences', {
            title: 'Prefers short answers',
            description: 'Keeps replies brief.',
            origin: 'extraction',
          })],
        },
      ])

      const wrapper = await mountEntries()
      const row = wrapper.get('[data-testid="memory-entry-row"]')

      expect(row.text()).toContain('Prefers short answers')
      expect(row.text()).toContain('Keeps replies brief.')
      expect(row.get('[data-testid="memory-entry-meta"]').text())
        .toBe('Updated just now')
      expect(row.text()).not.toContain('Extracted from chats')
    })

    it('renders no sensitive badge for any entry', async () => {
      entriesData.value = createResponse([
        {
          category: 'profile',
          entries: [
            createEntry('p1', 'profile', { sensitivity: 'special' }),
            createEntry('p2', 'profile', { sensitivity: 'none' }),
          ],
        },
      ])

      const wrapper = await mountEntries()

      expect(wrapper.findAll('[data-testid="memory-entry-row"]'))
        .toHaveLength(2)
      expect(wrapper.find('[data-testid="memory-entry-sensitive"]').exists())
        .toBe(false)
    })

    it('counts only account entries against the account limit', async () => {
      entriesData.value = createResponse([
        {
          category: 'profile',
          entries: [
            createEntry('p1', 'profile'),
            createEntry('p2', 'profile', { projectId: 'project-1' }),
          ],
        },
        {
          category: 'topics',
          entries: [
            createEntry('t1', 'topics', { projectId: 'project-1' }),
            createEntry('t2', 'topics', { projectId: 'project-2' }),
          ],
        },
      ])

      const wrapper = await mountEntries()

      expect(wrapper.get('[data-testid="memory-entries-count"]').text())
        .toBe('1 of 30')
      expect(wrapper.get('[data-testid="memory-entry-essentials"]')
        .findAll('[data-testid="memory-entry-row"]')).toHaveLength(1)
      expect(wrapper.find('[data-testid="memory-entry-group"]').exists())
        .toBe(false)
    })
  })

  describe('projects', () => {
    function createMixedResponse() {
      return createResponse([
        {
          category: 'profile',
          entries: [
            createEntry('p1', 'profile'),
            createEntry('p2', 'profile', { projectId: 'project-1' }),
          ],
        },
        {
          category: 'topics',
          entries: [
            createEntry('t1', 'topics', { projectId: 'project-2' }),
            createEntry('t2', 'topics', { projectId: 'project-1' }),
          ],
        },
        {
          category: 'people',
          entries: [createEntry('o1', 'people', { projectId: 'project-1' })],
        },
      ])
    }

    it('fetches everything in one request under a stable key', async () => {
      await mountEntries()

      const options = entriesOptions()

      expect(toValue(options.query)).toEqual({ scope: 'all' })
      expect(toValue(options.key)).toBe('memory-entries:all')
      expect(mocks.useLazyFetch.mock.calls.filter(([url]) => {
        return url === ENTRIES_URL
      })).toHaveLength(1)
    })

    it('lists projects that have entries, collapsed, with their counts',
      async () => {
        entriesData.value = createMixedResponse()

        const wrapper = await mountEntries()
        const rows = wrapper.findAll('[data-testid="memory-project"]')

        expect(rows.map(row => row.attributes('data-project-id')))
          .toEqual(['project-1', 'project-2'])
        expect(rows.map(row => row.get('[data-testid="memory-project-name"]')
          .text())).toEqual(['Home lab', 'Side project'])
        expect(rows.map(row => row.get('[data-testid="memory-project-count"]')
          .text())).toEqual(['3 of 15', '1 of 15'])
        expect(rows.map(row => row.get('[data-testid="memory-project-toggle"]')
          .attributes('aria-expanded'))).toEqual(['false', 'false'])
        expect(wrapper.get('[data-testid="memory-projects-count"]').text())
          .toBe('2')
      })

    it('hides projects without entries', async () => {
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()

      expect(wrapper.text()).not.toContain('Quiet project')
    })

    it('keeps account entries out of the project rows', async () => {
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()
      const toggles = wrapper.findAll('[data-testid="memory-project-toggle"]')

      for (const toggle of toggles) {
        await toggle.trigger('click')
      }

      const projectTitles = wrapper
        .findAll('[data-testid="memory-project-panel"] [data-testid="memory-entry-row"]')
        .map(row => row.get('.truncate').text())

      expect(projectTitles).toEqual([
        'Title p2',
        'Title t2',
        'Title o1',
        'Title t1',
      ])
    })

    it('marks a project with memory off but still lists its entries',
      async () => {
        entriesData.value = createMixedResponse()

        const wrapper = await mountEntries()
        const rows = wrapper.findAll('[data-testid="memory-project"]')

        expect(rows[0]!.find('[data-testid="memory-project-off"]').exists())
          .toBe(false)
        expect(rows[1]!.get('[data-testid="memory-project-off"]').text())
          .toBe('Memory off')
      })

    it('names a project missing from the projects list', async () => {
      entriesData.value = createResponse([
        {
          category: 'topics',
          entries: [createEntry('t1', 'topics', { projectId: 'ghost' })],
        },
      ])

      const wrapper = await mountEntries()
      const row = wrapper.get('[data-testid="memory-project"]')

      expect(row.attributes('data-project-id')).toBe('ghost')
      expect(row.get('[data-testid="memory-project-name"]').text())
        .toBe('Unknown project')
    })

    it('names an archived project and marks it archived', async () => {
      archivedProjectsData.value = {
        pinned: [],
        projects: [{ id: 'old', name: 'Old project', memoryStatus: 'idle' }],
        nextCursor: null,
      }
      entriesData.value = createResponse([
        {
          category: 'topics',
          entries: [
            createEntry('t1', 'topics', { projectId: 'old' }),
            createEntry('t2', 'topics', { projectId: 'project-1' }),
          ],
        },
      ])

      const wrapper = await mountEntries()
      const rows = wrapper.findAll('[data-testid="memory-project"]')

      expect(rows.map(row => row.get('[data-testid="memory-project-name"]')
        .text())).toEqual(['Home lab', 'Old project'])
      expect(rows[0]!.find('[data-testid="memory-project-archived"]').exists())
        .toBe(false)
      expect(rows[1]!.get('[data-testid="memory-project-archived"]').text())
        .toBe('Archived')
      expect(wrapper.text()).not.toContain('Unknown project')
      expect(wrapper.find('[data-testid="memory-projects-names-error"]')
        .exists()).toBe(false)
    })

    it('shows a retry notice instead of silently naming projects Unknown',
      async () => {
        archivedProjectsData.value = null
        archivedProjectsError.value = new Error('Failed')
        entriesData.value = createMixedResponse()

        const wrapper = await mountEntries()
        const notice = wrapper.get('[data-testid="memory-projects-names-error"]')

        expect(notice.text()).toContain('Couldn\'t load project names.')
        expect(notice.get('[data-testid="memory-projects-names-retry"]').text())
          .toBe('Try again')

        const html = wrapper.get('[data-testid="memory-entries-section"]')
          .html()

        expect(html.indexOf('memory-projects-names-error'))
          .toBeLessThan(html.indexOf('data-testid="memory-projects"'))

        await notice.get('[data-testid="memory-projects-names-retry"]')
          .trigger('click')

        expect(projectsRefresh).toHaveBeenCalledOnce()
        expect(archivedProjectsRefresh).toHaveBeenCalledOnce()
      })

    it('shows the retry notice when the active projects failed', async () => {
      projectsData.value = null
      projectsError.value = new Error('Failed')
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-projects-names-error"]')
        .exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="memory-project-name"]')
        .map(name => name.text())).toEqual(['Unknown project', 'Unknown project'])
    })

    it('does not show the notice when there is no project section', async () => {
      projectsError.value = new Error('Failed')

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-projects-names-error"]')
        .exists()).toBe(false)
    })

    it('waits for the projects before showing any row', async () => {
      entriesData.value = createMixedResponse()
      projectsData.value = null
      projectsPending.value = true

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-entries-skeleton"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="memory-project"]').exists())
        .toBe(false)
      expect(wrapper.text()).not.toContain('Unknown project')
    })

    it('expands and collapses a project with its toggle', async () => {
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()
      const toggle = wrapper.get('[data-testid="memory-project-toggle"]')

      await toggle.trigger('click')

      const panel = wrapper.get('[data-testid="memory-project-panel"]')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(toggle.attributes('aria-controls')).toBe(panel.attributes('id'))
      expect(panel.findAll('[data-testid="memory-entry-row"]'))
        .toHaveLength(3)
      expect(panel.findAll('[data-testid="memory-entry-label"]')
        .map(label => label.text()))
        .toEqual(['Profile', 'Topics', 'People'])

      await toggle.trigger('click')

      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('[data-testid="memory-project-panel"]').exists())
        .toBe(false)
    })

    it('links each expanded project to its page', async () => {
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()

      await wrapper.get('[data-testid="memory-project-toggle"]')
        .trigger('click')

      expect(JSON.parse(wrapper.get('[data-testid="memory-project-open"]')
        .attributes('data-to')!)).toBe('/chats/projects/project-1')
    })

    it('shows projects even when the account has no entries', async () => {
      entriesData.value = createResponse([
        {
          category: 'topics',
          entries: [createEntry('t1', 'topics', { projectId: 'project-1' })],
        },
      ])

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-entries-empty"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="memory-entry-essentials-empty"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="memory-project"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="memory-entries-count"]').text())
        .toBe('0 of 30')
    })

    it('has no scope switch', async () => {
      entriesData.value = createMixedResponse()

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-scope-select"]').exists())
        .toBe(false)
    })

    describe('?project= query', () => {
      it.each([
        ['/?project=project-2'],
        ['/?scope=project&project=project-2'],
      ])('expands and focuses the project for %s', async (route) => {
        entriesData.value = createMixedResponse()

        const wrapper = await mountEntries({}, route)
        const toggles = wrapper
          .findAll('[data-testid="memory-project-toggle"]')

        expect(toggles.map(toggle => toggle.attributes('aria-expanded')))
          .toEqual(['false', 'true'])
        expect(document.activeElement).toBe(toggles[1]!.element)
      })

      it('ignores a project that does not exist', async () => {
        entriesData.value = createMixedResponse()

        const wrapper = await mountEntries({}, '/?project=nope')

        expect(wrapper
          .findAll('[data-testid="memory-project-toggle"]')
          .map(toggle => toggle.attributes('aria-expanded')))
          .toEqual(['false', 'false'])
      })

      it('shows the targeted project expanded even without entries',
        async () => {
          entriesData.value = createMixedResponse()

          const wrapper = await mountEntries({}, '/?project=project-3')
          const rows = wrapper.findAll('[data-testid="memory-project"]')

          expect(rows.map(row => row.attributes('data-project-id')))
            .toEqual(['project-1', 'project-2', 'project-3'])

          const target = rows[2]!

          expect(target.get('[data-testid="memory-project-name"]').text())
            .toBe('Quiet project')
          expect(target.get('[data-testid="memory-project-count"]').text())
            .toBe('0 of 15')
          expect(target.get('[data-testid="memory-project-toggle"]')
            .attributes('aria-expanded')).toBe('true')
          expect(target.get('[data-testid="memory-project-empty"]').text())
            .toBe('No memory yet')
          expect(target.find('[data-testid="memory-entry-row"]').exists())
            .toBe(false)
          expect(target.find('[data-testid="memory-project-reset"]').exists())
            .toBe(false)
          expect(document.activeElement)
            .toBe(target.get('[data-testid="memory-project-toggle"]').element)
          expect(wrapper.get('[data-testid="memory-projects-count"]').text())
            .toBe('3')
        })

      it('keeps the targeted empty project after the focus was consumed',
        async () => {
          const wrapper = await mountEntries({}, '/?project=project-3')

          expect(wrapper.find('[data-testid="memory-entries-empty"]').exists())
            .toBe(false)
          expect(wrapper.findAll('[data-testid="memory-project"]'))
            .toHaveLength(1)

          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')

          expect(wrapper.findAll('[data-testid="memory-project"]'))
            .toHaveLength(1)
          expect(wrapper.get('[data-testid="memory-project-toggle"]')
            .attributes('aria-expanded')).toBe('true')
        })

      it('opens the add dialog for the targeted empty project', async () => {
        const wrapper = await mountEntries({}, '/?project=project-3')

        await wrapper.get('[data-testid="memory-project-add"]')
          .trigger('click')

        const modal = wrapper.get('[data-testid="detail-modal-stub"]')

        expect(modal.attributes('data-open')).toBe('true')
        expect(modal.attributes('data-project-id')).toBe('project-3')
      })

      it('does not change which entries are fetched', async () => {
        entriesData.value = createMixedResponse()

        await mountEntries({}, '/?scope=project&project=project-1')

        expect(toValue(entriesOptions().query)).toEqual({ scope: 'all' })
      })

      it('expands again when navigated to later', async () => {
        entriesData.value = createMixedResponse()

        const router = useRouter()
        const wrapper = await mountEntries()

        await router.push({ query: { project: 'project-1' } })
        await flushPromises()

        expect(wrapper.get('[data-testid="memory-project-toggle"]')
          .attributes('aria-expanded')).toBe('true')
      })
    })
  })

  describe('states', () => {
    it('shows a skeleton while the first load is pending', async () => {
      entriesData.value = null
      entriesPending.value = true

      const wrapper = await mountEntries()

      expect(wrapper.get('[data-testid="memory-entries-skeleton"]')
        .findAll('.skeleton.skeleton--default').length).toBeGreaterThan(0)
      expect(wrapper.find('[data-testid="memory-entries-empty"]').exists())
        .toBe(false)
    })

    it('keeps the list visible while refreshing', async () => {
      entriesData.value = createResponse([
        { category: 'profile', entries: [createEntry('p1', 'profile')] },
      ])
      entriesPending.value = true

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-entries-skeleton"]').exists())
        .toBe(false)
      expect(wrapper.findAll('[data-testid="memory-entry-row"]'))
        .toHaveLength(1)
    })

    it('shows the empty state with a generation hint', async () => {
      const wrapper = await mountEntries({ memoryExtractionEnabled: false })

      expect(wrapper.get('[data-testid="memory-entries-empty"]').text())
        .toContain('Nothing remembered yet')
      expect(wrapper.find(
        '[data-testid="memory-entries-empty-generation-hint"]',
      ).exists()).toBe(true)
    })

    it('omits the generation hint when generation is on', async () => {
      const wrapper = await mountEntries({ memoryExtractionEnabled: true })

      expect(wrapper.find(
        '[data-testid="memory-entries-empty-generation-hint"]',
      ).exists()).toBe(false)
    })

    it('shows the empty state when no project has entries either',
      async () => {
        const wrapper = await mountEntries()

        expect(wrapper.find('[data-testid="memory-project"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="memory-entries-empty"]').exists())
          .toBe(true)
      })

    it('shows the memory-off note above the list', async () => {
      const wrapper = await mountEntries({ memoryEnabled: false })

      expect(wrapper.get('[data-testid="memory-disabled-note"]').text())
        .toBe('Memory is off. Entries are kept but not used in chats.')
    })

    it('hides the memory-off note when memory is on', async () => {
      const wrapper = await mountEntries({ memoryEnabled: true })

      expect(wrapper.find('[data-testid="memory-disabled-note"]').exists())
        .toBe(false)
    })

    it('offers only a retry when loading fails', async () => {
      entriesData.value = null
      entriesError.value = Object.assign(new Error('Request failed'), {
        data: { statusCode: 500, message: 'Could not load memory' },
      })

      const wrapper = await mountEntries()

      expect(wrapper.find('[data-testid="memory-entries-retry"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="memory-entries-back-to-account"]')
        .exists()).toBe(false)
    })

    it('shows the parsed error and retries', async () => {
      entriesData.value = null
      entriesError.value = Object.assign(new Error('Request failed'), {
        data: {
          statusCode: 500,
          message: 'Could not load memory',
          data: {
            why: 'Database unavailable',
            fix: 'Try again in a minute.',
          },
        },
      })

      const wrapper = await mountEntries()
      const alert = wrapper.get('[data-testid="memory-entries-error"]')

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('Could not load memory')
      expect(alert.text()).toContain('Database unavailable')
      expect(alert.text()).toContain('Try again in a minute.')

      await wrapper.get('[data-testid="memory-entries-retry"]')
        .trigger('click')

      expect(refresh).toHaveBeenCalledOnce()
    })
  })

  describe('detail modal', () => {
    async function mountWithEntry() {
      const entry = createEntry('p1', 'profile')

      entriesData.value = createResponse([
        { category: 'profile', entries: [entry] },
      ])

      return { entry, wrapper: await mountEntries() }
    }

    it('starts closed', async () => {
      const { wrapper } = await mountWithEntry()

      expect(wrapper.get('[data-testid="detail-modal-stub"]')
        .attributes('data-open')).toBe('false')
    })

    it('opens with the clicked entry and the response limits', async () => {
      const { entry, wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')

      const modal = wrapper.getComponent(DetailModalStub)

      expect(modal.attributes('data-open')).toBe('true')
      expect(modal.attributes('data-entry-id')).toBe(entry.id)
      expect(modal.props('limits')).toEqual(entriesData.value!.limits)
    })

    it('closes when the modal updates its open model', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)

      expect(wrapper.get('[data-testid="detail-modal-stub"]')
        .attributes('data-open')).toBe('false')
    })

    it('opens the modal in create mode from the toolbar Add button',
      async () => {
        const { wrapper } = await mountWithEntry()

        await wrapper.get('[data-testid="memory-add"]').trigger('click')

        const modal = wrapper.getComponent(DetailModalStub)

        expect(modal.attributes('data-open')).toBe('true')
        expect(modal.attributes('data-entry-id')).toBe('')
        expect(modal.props('takenSingletonCategories')).toEqual(['profile'])
        expect(modal.props('projectId')).toBeNull()
      })

    it('create mode drops a previously selected entry', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)
      await wrapper.get('[data-testid="memory-add"]').trigger('click')

      expect(wrapper.getComponent(DetailModalStub).props('entry')).toBeNull()
    })

    describe('project entries', () => {
      function createProjectResponse() {
        return createResponse([
          {
            category: 'profile',
            entries: [
              createEntry('p1', 'profile'),
              createEntry('p2', 'profile', { projectId: 'project-1' }),
            ],
          },
          {
            category: 'topics',
            entries: [createEntry('t1', 'topics', { projectId: 'project-1' })],
          },
        ])
      }

      it('opens a project entry with its project and singleton categories',
        async () => {
          entriesData.value = createProjectResponse()

          const wrapper = await mountEntries()

          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-project-panel"] '
            + '[data-testid="memory-entry-row"]').trigger('click')

          const modal = wrapper.getComponent(DetailModalStub)

          expect(modal.attributes('data-open')).toBe('true')
          expect(modal.attributes('data-entry-id')).toBe('p2')
          expect(modal.props('projectId')).toBe('project-1')
          expect(modal.props('takenSingletonCategories'))
            .toEqual(['profile'])
        })

      it('opens create mode for a project from its Add memory button',
        async () => {
          entriesData.value = createProjectResponse()

          const wrapper = await mountEntries()

          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-project-add"]')
            .trigger('click')

          const modal = wrapper.getComponent(DetailModalStub)

          expect(modal.attributes('data-open')).toBe('true')
          expect(modal.attributes('data-entry-id')).toBe('')
          expect(modal.props('entry')).toBeNull()
          expect(modal.props('projectId')).toBe('project-1')
          expect(modal.props('takenSingletonCategories'))
            .toEqual(['profile'])
        })

      it('returns to account scope when an account entry opens afterwards',
        async () => {
          entriesData.value = createProjectResponse()

          const wrapper = await mountEntries()

          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-project-add"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-add"]').trigger('click')

          const modal = wrapper.getComponent(DetailModalStub)

          expect(modal.props('projectId')).toBeNull()
          expect(modal.props('takenSingletonCategories'))
            .toEqual(['profile'])
        })

      it('refreshes after a project reset', async () => {
        entriesData.value = createProjectResponse()
        mocks.confirm.mockResolvedValue({ label: 'Delete entries', index: 0 })
        mocks.fetch.mockResolvedValue({ deleted: 2 })

        const wrapper = await mountEntries()

        await wrapper.get('[data-testid="memory-project-toggle"]')
          .trigger('click')
        await wrapper.get('[data-testid="memory-project-reset"]')
          .trigger('click')
        await flushPromises()

        expect(mocks.confirm.mock.calls[0]![0].text)
          .toBe('Reset memory for "Home lab"?')
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/memory/entries/reset',
          {
            method: 'POST',
            body: { scope: 'project', projectId: 'project-1' },
          },
        )
        expect(mocks.info).toHaveBeenCalledWith(
          'Memory reset',
          'Deleted 2 entries.',
        )
        expect(refresh).toHaveBeenCalledOnce()
      })

      it('keeps the list when the project reset is cancelled', async () => {
        entriesData.value = createProjectResponse()
        mocks.confirm.mockResolvedValue(null)

        const wrapper = await mountEntries()

        await wrapper.get('[data-testid="memory-project-toggle"]')
          .trigger('click')
        await wrapper.get('[data-testid="memory-project-reset"]')
          .trigger('click')
        await flushPromises()

        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(refresh).not.toHaveBeenCalled()
      })

      it('shows a toast and keeps the list when the project reset fails',
        async () => {
          entriesData.value = createProjectResponse()
          mocks.confirm.mockResolvedValue({
            label: 'Delete entries',
            index: 0,
          })
          mocks.fetch.mockRejectedValue(Object.assign(
            new Error('Request failed'),
            {
              data: {
                statusCode: 500,
                message: 'Could not reset memory',
                data: { why: 'Database unavailable' },
              },
            },
          ))

          const wrapper = await mountEntries()

          await wrapper.get('[data-testid="memory-project-toggle"]')
            .trigger('click')
          await wrapper.get('[data-testid="memory-project-reset"]')
            .trigger('click')
          await flushPromises()

          expect(mocks.error).toHaveBeenCalledWith(
            'Could not reset memory',
            'Database unavailable',
          )
          expect(refresh).not.toHaveBeenCalled()
        })
    })

    it('refreshes the list after an entry was created without moving focus',
      async () => {
        const { wrapper } = await mountWithEntry()

        await wrapper.get('[data-testid="memory-add"]').trigger('click')
        await wrapper.get('[data-testid="detail-modal-created"]')
          .trigger('click')
        await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)
        await flushPromises()

        expect(refresh).toHaveBeenCalledOnce()
        expect(document.activeElement).not.toBe(
          wrapper.get('[data-testid="memory-entries-heading"]').element,
        )
      })

    it('refreshes the list when the modal reports a change', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.get('[data-testid="detail-modal-changed"]')
        .trigger('click')

      expect(refresh).toHaveBeenCalledOnce()
    })

    it('leaves focus alone after a plain save', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.get('[data-testid="detail-modal-changed"]')
        .trigger('click')
      await flushPromises()

      expect(document.activeElement)
        .not.toBe(wrapper.get('[data-testid="memory-entries-heading"]').element)
    })

    it('moves focus to the entries heading after a delete', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)
      await wrapper.get('[data-testid="detail-modal-deleted"]')
        .trigger('click')
      await flushPromises()

      const heading = wrapper.get('[data-testid="memory-entries-heading"]')

      expect(heading.attributes('tabindex')).toBe('-1')
      expect(heading.classes()).toContain('js-memory-entries-heading')
      expect(document.activeElement).toBe(heading.element)
    })

    it('waits for the modal to close before focusing after a category move',
      async () => {
        const { wrapper } = await mountWithEntry()
        const heading = wrapper.get('[data-testid="memory-entries-heading"]')

        await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
        await wrapper.get('[data-testid="detail-modal-category-changed"]')
          .trigger('click')
        await flushPromises()

        expect(document.activeElement).not.toBe(heading.element)

        await wrapper.getComponent(DetailModalStub).vm
          .$emit('update:open', false)
        await flushPromises()

        expect(document.activeElement).toBe(heading.element)
      })
  })

  describe('earlier about me', () => {
    const LEGACY_TEXT = 'I am a **backend** developer\n<b>second</b> line'

    async function mountLegacy(
      reason: AboutMeNotMigratedReason | null,
      aboutMe: string | null = LEGACY_TEXT,
    ) {
      entriesData.value = createResponse([
        { category: 'topics', entries: [createEntry('t1', 'topics')] },
      ])

      return await mountEntries({ aboutMe }, '/', reason)
    }

    it('is hidden without leftover text', async () => {
      const wrapper = await mountLegacy(null, null)

      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(false)
    })

    it('is hidden for blank leftover text', async () => {
      const wrapper = await mountLegacy('too-long', '  \n ')

      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(false)
    })

    it('is a collapsed block above the groups with plain text only',
      async () => {
        const wrapper = await mountLegacy('too-long')
        const legacy = wrapper.get('[data-testid="memory-legacy-about-me"]')
        const text = legacy.get('[data-testid="memory-legacy-about-me-text"]')

        expect(legacy.element.tagName).toBe('DETAILS')
        expect(legacy.attributes('open')).toBeUndefined()
        expect(legacy.classes()).toContain('rounded-box')
        expect(legacy.get('summary').text())
          .toBe('Earlier about me (not converted)')
        expect(text.text()).toBe(LEGACY_TEXT)
        expect(text.classes()).toEqual(expect.arrayContaining([
          'whitespace-pre-wrap',
          'break-words',
        ]))
        expect(text.find('b').exists()).toBe(false)
        expect(text.find('strong').exists()).toBe(false)
        expect(legacy.text())
          .toContain('This text is still sent with every chat until you remove it.')

        const section = wrapper.get('[data-testid="memory-entries-section"]')
        const html = section.html()

        expect(html.indexOf('memory-legacy-about-me"'))
          .toBeLessThan(html.indexOf('memory-entries-list'))
      })

    it.each([
      [
        'too-long',
        'It is too long to become a Profile entry (limit 1 KB). Shorten it '
        + 'into an entry yourself, then remove this.',
      ],
      [
        'profile-exists',
        'You already have a Profile entry, so this was not merged. Copy what '
        + 'you need into it, then remove this.',
      ],
      [
        'memory-off',
        'Turn on Use memory and it will be converted automatically.',
      ],
      [
        'rejected',
        'It contains details Besidka does not save to memory, so it was not '
        + 'converted.',
      ],
      [
        'entries-full',
        'Your account memory is full (30 entries). Delete one and this '
        + 'converts automatically.',
      ],
      [null, 'It is still sent with every chat.'],
    ] as const)('explains the %s reason', async (reason, expected) => {
      const wrapper = await mountLegacy(reason)

      expect(wrapper.get('[data-testid="memory-legacy-about-me-reason"]')
        .text()).toBe(expected)
    })

    it('removes the text after confirmation', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Remove', index: 0 })
      mocks.fetch.mockResolvedValue({})

      const wrapper = await mountLegacy('too-long')

      await wrapper.get('[data-testid="memory-legacy-about-me-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Remove earlier about me?',
        subtitle: 'It will no longer be sent with your chats. '
          + 'This cannot be undone.',
        alert: true,
        actions: ['Remove'],
        labelDecline: 'Cancel',
      })
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/settings',
        { method: 'PATCH', body: { aboutMe: null } },
      )
      expect(mocks.info).toHaveBeenCalledWith(
        'Removed',
        'Earlier about me removed.',
      )
      expect(wrapper.emitted('aboutMeRemoved')).toHaveLength(1)
      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(true)

      await wrapper.setProps({
        settings: { ...defaultSettings, aboutMe: null },
      })

      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(false)
    })

    it('keeps the text when the confirmation is declined', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountLegacy('too-long')

      await wrapper.get('[data-testid="memory-legacy-about-me-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(true)
    })

    it('keeps the text and shows a toast when removing fails', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Remove', index: 0 })
      mocks.fetch.mockRejectedValue(Object.assign(new Error('Request failed'), {
        data: {
          statusCode: 500,
          message: 'Could not save',
          data: { why: 'Database unavailable' },
        },
      }))

      const wrapper = await mountLegacy('too-long')

      await wrapper.get('[data-testid="memory-legacy-about-me-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Could not save',
        'Database unavailable',
      )
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('aboutMeRemoved')).toBeUndefined()
      expect(wrapper.find('[data-testid="memory-legacy-about-me"]').exists())
        .toBe(true)
    })
  })

  it('renders nothing in the extra actions slot by default', async () => {
    const wrapper = await mountEntries()

    expect(wrapper.find('.js-memory-extra-actions').exists()).toBe(false)
  })

  it('forwards the extra actions slot to the toolbar', async () => {
    const wrapper = await mountEntries({}, '/', null, {
      'extra-actions': () => h('button', {
        'type': 'button',
        'data-testid': 'future-action',
      }, 'Import memory from another assistant'),
    })

    expect(wrapper.get('.js-memory-extra-actions')
      .find('[data-testid="future-action"]').exists()).toBe(true)
  })

  it('refreshes the list after the toolbar changes memory', async () => {
    mocks.confirm.mockResolvedValue({ label: 'Delete entries', index: 0 })
    mocks.fetch.mockResolvedValue({ deleted: 1 })
    entriesData.value = createResponse([
      { category: 'profile', entries: [createEntry('p1', 'profile')] },
    ])

    const wrapper = await mountEntries()

    await wrapper.get('[data-testid="memory-reset"]').trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/memory/entries/reset',
      { method: 'POST', body: { scope: 'account' } },
    )
    expect(refresh).toHaveBeenCalledOnce()
  })
})
