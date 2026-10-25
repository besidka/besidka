import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, shallowRef, toValue } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
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
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)

enableAutoUnmount(afterEach)

const ENTRIES_URL = '/api/v1/memory/entries'
const PROJECT_ROUTE = '/?scope=project&project=project-1'

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
  props: ['open', 'entry', 'limits'],
  emits: ['update:open', 'changed'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'detail-modal-stub',
      'data-open': String(props.open),
      'data-entry-id': props.entry?.id ?? '',
    }, [
      h('button', {
        'data-testid': 'detail-modal-changed',
        'onClick': () => emit('changed'),
      }),
    ])
  },
})

const entriesData = shallowRef<MemoryEntriesResponse | null>(null)
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
    scope: 'account',
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
) {
  const wrapper = await mountSuspended(Entries, {
    route,
    props: { settings: { ...defaultSettings, ...settings } },
    global: {
      stubs: {
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
    entriesPending.value = false
    entriesError.value = null
    refresh.mockReset()
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockImplementation((url: string) => {
      if (url === ENTRIES_URL) {
        return {
          data: entriesData,
          pending: entriesPending,
          error: entriesError,
          refresh,
        }
      }

      return {
        data: shallowRef({
          pinned: [],
          projects: [{ id: 'project-1', name: 'Home lab' }],
          nextCursor: null,
        }),
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
      + 'Edit or delete anything.',
    )
  })

  describe('list', () => {
    it('groups entries in category order and skips empty groups', async () => {
      entriesData.value = createResponse([
        { category: 'topics', entries: [createEntry('t1', 'topics')] },
        { category: 'people', entries: [] },
        {
          category: 'profile',
          entries: [createEntry('p1', 'profile'), createEntry('p2', 'profile')],
        },
        { category: 'preferences', entries: [createEntry('f1', 'preferences')] },
      ])

      const wrapper = await mountEntries()
      const groups = wrapper.findAll('[data-testid="memory-entry-group"]')

      expect(groups.map(group => group.attributes('data-category')))
        .toEqual(['profile', 'preferences', 'topics'])
      expect(groups.map(group => group.get('h3').text()))
        .toEqual(['Profile 2', 'Preferences 1', 'Topics 1'])
    })

    it('shows title, description, updated and origin on each row', async () => {
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
        .toBe('Updated just now · Extracted from chats')
    })

    it('marks only special entries as sensitive', async () => {
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
      const rows = wrapper.findAll('[data-testid="memory-entry-row"]')

      expect(rows[0]!.find('[data-testid="memory-entry-sensitive"]').exists())
        .toBe(true)
      expect(rows[1]!.find('[data-testid="memory-entry-sensitive"]').exists())
        .toBe(false)
    })

    it('shows the count against the account limit', async () => {
      entriesData.value = createResponse([
        { category: 'profile', entries: [createEntry('p1', 'profile')] },
      ])

      const wrapper = await mountEntries()

      expect(wrapper.get('[data-testid="memory-entries-count"]').text())
        .toBe('1 of 30')
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

    it('shows the project empty state in project scope', async () => {
      const wrapper = await mountEntries({}, PROJECT_ROUTE)

      expect(wrapper.find('[data-testid="memory-entries-empty-project"]')
        .exists()).toBe(true)
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

  describe('scope', () => {
    it('fetches the account scope by default', async () => {
      await mountEntries()

      const options = entriesOptions()

      expect(toValue(options.query)).toEqual({ scope: 'account' })
      expect(toValue(options.key)).toBe('memory-entries:account')
    })

    it('reads the project from the route query', async () => {
      entriesData.value = createResponse([], {
        scope: 'project',
        projectId: 'project-1',
      })

      const wrapper = await mountEntries({}, PROJECT_ROUTE)
      const options = entriesOptions()

      expect(toValue(options.query))
        .toEqual({ scope: 'project', projectId: 'project-1' })
      expect(toValue(options.key)).toBe('memory-entries:project-1')
      expect(wrapper.get<HTMLSelectElement>(
        '[data-testid="memory-scope-select"]',
      ).element.value).toBe('project-1')
    })

    it('shows the project limit in project scope', async () => {
      entriesData.value = createResponse([
        { category: 'profile', entries: [createEntry('p1', 'profile')] },
      ], { scope: 'project', projectId: 'project-1' })

      const wrapper = await mountEntries({}, PROJECT_ROUTE)

      expect(wrapper.get('[data-testid="memory-entries-count"]').text())
        .toBe('1 of 15')
    })

    it('falls back to the account when the project id is missing', async () => {
      await mountEntries({}, '/?scope=project')

      expect(toValue(entriesOptions().query)).toEqual({ scope: 'account' })
    })

    it('writes the chosen project to the route and refetches', async () => {
      const router = useRouter()
      const replace = vi.spyOn(router, 'replace')
      const wrapper = await mountEntries()

      replace.mockClear()
      await wrapper.get('[data-testid="memory-scope-select"]')
        .setValue('project-1')
      await flushPromises()

      expect(replace).toHaveBeenCalledWith({
        query: { scope: 'project', project: 'project-1' },
      })
      await vi.waitFor(() => {
        expect(toValue(entriesOptions().query))
          .toEqual({ scope: 'project', projectId: 'project-1' })
      })
      expect(toValue(entriesOptions().key)).toBe('memory-entries:project-1')
    })

    it('clears the scope from the route when switching to account',
      async () => {
        const router = useRouter()
        const replace = vi.spyOn(router, 'replace')
        const wrapper = await mountEntries(
          {},
          '/?scope=project&project=project-1&other=kept',
        )

        await wrapper.get('[data-testid="memory-scope-select"]')
          .setValue('account')
        await flushPromises()

        expect(replace).toHaveBeenCalledWith({ query: { other: 'kept' } })
        await vi.waitFor(() => {
          expect(toValue(entriesOptions().query))
            .toEqual({ scope: 'account' })
        })
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

    it('refreshes the list when the modal reports a change', async () => {
      const { wrapper } = await mountWithEntry()

      await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
      await wrapper.get('[data-testid="detail-modal-changed"]')
        .trigger('click')

      expect(refresh).toHaveBeenCalledOnce()
    })
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
