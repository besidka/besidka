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
  aboutMeNotMigratedReason: AboutMeNotMigratedReason | null = null,
) {
  const wrapper = await mountSuspended(Entries, {
    route,
    attachTo: document.body,
    props: {
      settings: { ...defaultSettings, ...settings },
      aboutMeNotMigratedReason,
    },
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
    mocks.info.mockReset()
    mocks.error.mockReset()
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
      + 'Add, edit or delete anything.',
    )
  })

  describe('list', () => {
    it('puts profile and preferences under You, then the other groups',
      async () => {
        entriesData.value = createResponse([
          { category: 'topics', entries: [createEntry('t1', 'topics')] },
          { category: 'people', entries: [] },
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
          .toEqual(['areas', 'topics'])
        expect(groups.map(group => group.get('h3 > span').text()))
          .toEqual(['Areas', 'Topics'])

        const orderedTitles = list.findAll('[data-testid="memory-entry-row"]')
          .map(row => row.text())

        expect(orderedTitles).toEqual([
          expect.stringContaining('Title p1'),
          expect.stringContaining('Title f1'),
          expect.stringContaining('Title a1'),
          expect.stringContaining('Title t1'),
        ])
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
    })

    it('labels the group Essentials in project scope without a call to action',
      async () => {
        entriesData.value = createResponse([
          { category: 'topics', entries: [createEntry('t1', 'topics')] },
        ], { scope: 'project', projectId: 'project-1' })

        const wrapper = await mountEntries({}, PROJECT_ROUTE)

        expect(wrapper.find('[data-testid="memory-entry-essentials"]').exists())
          .toBe(false)

        entriesData.value = createResponse([
          {
            category: 'profile',
            entries: [createEntry('p1', 'profile', { projectId: 'project-1' })],
          },
        ], { scope: 'project', projectId: 'project-1' })

        const withProfile = await mountEntries({}, PROJECT_ROUTE)

        expect(withProfile.get(
          '[data-testid="memory-entry-essentials-heading"]',
        ).text()).toBe('Essentials')
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

    it('offers a way back to account memory in project scope', async () => {
      entriesData.value = null
      entriesError.value = Object.assign(new Error('Request failed'), {
        data: { statusCode: 404, message: 'Project not found' },
      })

      const router = useRouter()
      const replace = vi.spyOn(router, 'replace')
      const wrapper = await mountEntries({}, '/?scope=project&project=gone&x=1')

      replace.mockClear()
      await wrapper.get('[data-testid="memory-entries-back-to-account"]')
        .trigger('click')
      await flushPromises()

      expect(replace).toHaveBeenCalledWith({ query: { x: '1' } })
      expect(wrapper.find('[data-testid="memory-entries-retry"]').exists())
        .toBe(true)
    })

    it('does not offer account memory in the account scope', async () => {
      entriesData.value = null
      entriesError.value = Object.assign(new Error('Request failed'), {
        data: { statusCode: 500, message: 'Could not load memory' },
      })

      const wrapper = await mountEntries()

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

    it('passes the project id to the modal in project scope', async () => {
      entriesData.value = createResponse([], {
        scope: 'project',
        projectId: 'project-1',
      })

      const wrapper = await mountEntries({}, PROJECT_ROUTE)

      expect(wrapper.getComponent(DetailModalStub).props('projectId'))
        .toBe('project-1')
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

    it('is hidden in project scope', async () => {
      const wrapper = await mountEntries(
        { aboutMe: LEGACY_TEXT },
        PROJECT_ROUTE,
        'too-long',
      )

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
