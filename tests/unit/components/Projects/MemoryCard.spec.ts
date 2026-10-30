import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryCategory,
  MemoryEntry,
} from '#shared/types/memory.d'
import type { ProjectMemoryCardResponse } from '#shared/types/project-memory.d'
import MemoryCard from '../../../../app/components/Projects/MemoryCard.vue'

vi.mock('#app', async (importOriginal) => {
  return await importOriginal<Record<string, unknown>>()
})

enableAutoUnmount(afterEach)

const DetailModalStub = defineComponent({
  props: ['open', 'entry', 'limits', 'projectId', 'takenSingletonCategories'],
  emits: ['update:open', 'changed'],
  setup(props, { emit }) {
    return () => h('button', {
      'type': 'button',
      'data-testid': 'detail-modal-stub',
      'data-open': String(props.open),
      'data-entry-id': props.entry?.id ?? '',
      'onClick': () => emit('changed', { reason: 'deleted' }),
    })
  },
})

function createEntry(
  id: string,
  category: MemoryCategory,
  title: string,
): MemoryEntry {
  return {
    id,
    projectId: 'project-1',
    category,
    slug: id,
    title,
    description: `${title} description`,
    body: 'Body',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'extraction',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

const limits = {
  maxAccountEntries: 50,
  maxProjectEntries: 15,
  maxBodyBytes: 4000,
  maxAlwaysInjectedBodyBytes: 2000,
  maxDescriptionChars: 200,
  maxTitleChars: 80,
}

function createCard(
  overrides: Partial<ProjectMemoryCardResponse> = {},
): ProjectMemoryCardResponse {
  return {
    projectId: 'project-1',
    memoryStatus: 'ready',
    memoryUpdatedAt: new Date().toISOString(),
    memoryDirtyAt: null,
    memoryProvider: 'google',
    memoryModel: 'gemini-3.1-flash-lite',
    memoryError: null,
    usesEntries: true,
    useAccountMemory: true,
    legacyMemory: null,
    total: 3,
    limits,
    groups: [
      {
        category: 'topics',
        entries: [createEntry('entry-topic', 'topics', 'Migration plan')],
      },
      {
        category: 'preferences',
        entries: [
          createEntry('entry-pref-1', 'preferences', 'Prefers TypeScript'),
          createEntry('entry-pref-2', 'preferences', 'Uses pnpm'),
        ],
      },
    ],
    ...overrides,
  }
}

async function mountCard(
  card: ProjectMemoryCardResponse | null,
  props: {
    isRefreshing?: boolean
    isToggling?: boolean
    automaticUpdates?: boolean
    isSavingAccountMemory?: boolean
  } = {},
) {
  const wrapper = await mountSuspended(MemoryCard, {
    props: {
      projectId: 'project-1',
      card,
      isRefreshing: false,
      isToggling: false,
      ...props,
    },
    global: {
      stubs: {
        UiBubble: { template: '<div><slot /></div>' },
        NuxtLink: {
          props: ['to'],
          template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
        },
        LazyProfileMemoryEntriesDetailModal: DetailModalStub,
        ProfileMemoryEntriesDetailModal: DetailModalStub,
      },
    },
  })

  await flushPromises()

  return wrapper
}

describe('Projects/MemoryCard', () => {
  it('renders the title, the automatic hint and no badge when ready',
    async () => {
      const wrapper = await mountCard(createCard(), {
        automaticUpdates: true,
      })
      const hint = wrapper.get('[data-testid="project-memory-hint"]')

      expect(wrapper.text()).toContain('Project memory')
      expect(hint.text()).toBe(
        'Updates automatically after chats in this project; turn it off per '
        + 'project.',
      )
      expect(wrapper.find('[data-testid="project-memory-settings-link"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="project-memory-status"]').exists())
        .toBe(false)
    })

  it('treats automatic updates as off by default and links to settings',
    async () => {
      const wrapper = await mountCard(createCard())
      const hint = wrapper.get('[data-testid="project-memory-hint"]')
      const link = wrapper.get(
        '[data-testid="project-memory-settings-link"]',
      )

      expect(hint.text().replace(/\s+/g, ' ')).toBe(
        'Automatic updates are off. Use Refresh memory, or turn on Generate '
        + 'memory from chats in Memory settings.',
      )
      expect(link.text()).toBe('Memory settings')
      expect(link.attributes('data-to')).toBe(JSON.stringify('/profile/memory'))
    })

  it('shows the model, the updated age and the error label', async () => {
    const wrapper = await mountCard(createCard({
      memoryStatus: 'stale',
      memoryError: 'Hit the per-run cap',
    }))
    const meta = wrapper.get('[data-testid="project-memory-meta"]')

    expect(wrapper.get('[data-testid="project-memory-status"]').text())
      .toContain('Out of date')
    expect(meta.text()).toContain('Model: google / gemini-3.1-flash-lite')
    expect(meta.text()).toContain('Updated')
    expect(meta.text()).toContain('Hit the per-run cap')
  })

  it('omits the model line when the provider or model is missing',
    async () => {
      const wrapper = await mountCard(createCard({
        memoryProvider: 'google',
        memoryModel: null,
        memoryUpdatedAt: null,
      }))

      expect(wrapper.find('[data-testid="project-memory-meta"]').exists())
        .toBe(false)
    })

  it('renders the entries in category order with the N of limit count',
    async () => {
      const wrapper = await mountCard(createCard())
      const groups = wrapper.findAll('[data-testid="memory-entry-group"]')
      const essentials = wrapper.get('[data-testid="memory-entry-essentials"]')

      expect(essentials.get('h3 > span').text()).toBe('Essentials')
      expect(essentials.findAll('[data-testid="memory-entry-label"]')
        .map(label => label.text()))
        .toEqual(['Preferences', 'Preferences'])
      expect(groups.map(group => group.attributes('data-category')))
        .toEqual(['topics'])
      expect(wrapper.findAll('[data-testid="memory-entry-row"]')).toHaveLength(3)
      expect(wrapper.get('[data-testid="project-memory-count"]').text())
        .toBe('3 of 15 entries')
      expect(wrapper.get('[data-testid="project-memory-count"] .sr-only')
        .text()).toBe('entries')
    })

  it('opens the detail modal for a row and re-emits changed', async () => {
    const wrapper = await mountCard(createCard())
    const modal = wrapper.getComponent(DetailModalStub)

    expect(modal.attributes('data-open')).toBe('false')
    expect(modal.props('limits')).toEqual(limits)

    await wrapper.findAll('[data-testid="memory-entry-row"]')[0]!
      .trigger('click')

    expect(modal.attributes('data-open')).toBe('true')
    expect(modal.attributes('data-entry-id')).toBe('entry-pref-1')

    await modal.trigger('click')

    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it('passes the project id and the taken singleton categories to the modal',
    async () => {
      const wrapper = await mountCard(createCard())
      const modal = wrapper.getComponent(DetailModalStub)

      expect(modal.props('projectId')).toBe('project-1')
      expect(modal.props('takenSingletonCategories'))
        .toEqual(['preferences'])
    })

  it('passes no taken singleton categories without essential entries',
    async () => {
      const wrapper = await mountCard(createCard({
        total: 1,
        groups: [{
          category: 'topics',
          entries: [createEntry('entry-topic', 'topics', 'Migration plan')],
        }],
      }))

      expect(wrapper.getComponent(DetailModalStub)
        .props('takenSingletonCategories')).toEqual([])
      expect(wrapper.find('[data-testid="memory-entry-essentials"]').exists())
        .toBe(false)
    })

  it('opens the modal in create mode from Add memory', async () => {
    const wrapper = await mountCard(createCard())

    await wrapper.findAll('[data-testid="memory-entry-row"]')[0]!
      .trigger('click')
    await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)

    const addButton = wrapper.get('[data-testid="project-memory-add"]')

    expect(addButton.text()).toBe('Add memory')

    await addButton.trigger('click')

    const modal = wrapper.getComponent(DetailModalStub)

    expect(modal.attributes('data-open')).toBe('true')
    expect(modal.attributes('data-entry-id')).toBe('')
  })

  it('offers Add memory when nothing is remembered yet', async () => {
    const wrapper = await mountCard(createCard({
      memoryStatus: 'idle',
      total: 0,
      groups: [],
    }))

    expect(wrapper.find('[data-testid="project-memory-add"]').exists())
      .toBe(true)
  })

  it('hides Add memory while disabled or loading', async () => {
    const disabled = await mountCard(createCard({ memoryStatus: 'disabled' }))
    const loading = await mountCard(null)

    expect(disabled.find('[data-testid="project-memory-add"]').exists())
      .toBe(false)
    expect(loading.find('[data-testid="project-memory-add"]').exists())
      .toBe(false)
  })

  it('stacks Add memory between Refresh and Disable on mobile', async () => {
    const wrapper = await mountCard(createCard())

    expect(wrapper.get('[data-testid="refresh-project-memory"]').classes())
      .toContain('max-sm:order-1')
    expect(wrapper.get('[data-testid="project-memory-add"]').classes())
      .toEqual(expect.arrayContaining(['max-sm:btn-block', 'max-sm:order-2']))
    expect(wrapper.get('[data-testid="toggle-project-memory"]').classes())
      .toContain('max-sm:order-3')
    expect(wrapper.get('[data-testid="manage-project-memory-entries"]')
      .classes()).toContain('max-sm:order-4')
  })

  it('closes the modal when it updates its open model', async () => {
    const wrapper = await mountCard(createCard())

    await wrapper.findAll('[data-testid="memory-entry-row"]')[0]!
      .trigger('click')
    await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)

    expect(wrapper.get('[data-testid="detail-modal-stub"]')
      .attributes('data-open')).toBe('false')
  })

  it('explains the out-of-date badge when updates are off', async () => {
    const wrapper = await mountCard(createCard({ memoryStatus: 'stale' }))
    const badge = wrapper.get('[data-testid="project-memory-status"]')

    expect(badge.attributes('title')).toBe(
      'Not updated automatically. Use Refresh memory to update it.',
    )
    expect(wrapper.get('[data-testid="project-memory-status-explanation"]')
      .text()).toBe(
      'Not updated automatically. Use Refresh memory to update it.',
    )
  })

  it('explains the out-of-date badge when updates are on', async () => {
    const wrapper = await mountCard(
      createCard({ memoryStatus: 'stale' }),
      { automaticUpdates: true },
    )
    const badge = wrapper.get('[data-testid="project-memory-status"]')
    const explanation = 'Updates automatically about 10 minutes after the '
      + 'last message in a chat, or use Refresh memory.'

    expect(badge.attributes('title')).toBe(explanation)
    expect(wrapper.get('[data-testid="project-memory-status-explanation"]')
      .text()).toBe(explanation)
  })

  it('adds no explanation to badges other than out of date', async () => {
    const wrapper = await mountCard(createCard({ memoryStatus: 'failed' }))
    const badge = wrapper.get('[data-testid="project-memory-status"]')

    expect(badge.text()).toBe('Failed')
    expect(badge.attributes('title')).toBeUndefined()
    expect(wrapper.find('[data-testid="project-memory-status-explanation"]')
      .exists()).toBe(false)
  })

  it('shows the empty state with refresh guidance when updates are off',
    async () => {
      const wrapper = await mountCard(createCard({
        memoryStatus: 'idle',
        total: 0,
        groups: [],
      }))

      expect(wrapper.get('[data-testid="project-memory-status"]').text())
        .toBe('Empty')
      expect(wrapper.get('[data-testid="project-memory-empty"]').text())
        .toBe(
          'Nothing remembered for this project yet. Use Refresh memory to '
          + 'build it from this project\'s chats.',
        )
      expect(wrapper.find('[data-testid="project-memory-count"]').exists())
        .toBe(false)
    })

  it('shows the empty state with build-up copy when updates are on',
    async () => {
      const wrapper = await mountCard(
        createCard({ memoryStatus: 'idle', total: 0, groups: [] }),
        { automaticUpdates: true },
      )

      expect(wrapper.get('[data-testid="project-memory-empty"]').text())
        .toBe(
          'Nothing remembered for this project yet. It will build up from '
          + 'chats in this project.',
        )
    })

  it('hides the Empty badge when an idle project already has entries',
    async () => {
      const wrapper = await mountCard(createCard({ memoryStatus: 'idle' }))

      expect(wrapper.find('[data-testid="project-memory-status"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="project-memory-count"]').exists())
        .toBe(true)
    })

  it('shows the disabled state and hides entries, legacy and refresh',
    async () => {
      const wrapper = await mountCard(createCard({
        memoryStatus: 'disabled',
        legacyMemory: 'Old notes',
      }))

      expect(wrapper.get('[data-testid="project-memory-status"]').text())
        .toBe('Disabled')
      expect(wrapper.get('[data-testid="project-memory-disabled"]').text())
        .toBe(
          'Project memory is off. Turn it on to keep it up to date from this '
          + 'project\'s chats.',
        )
      expect(wrapper.find('[data-testid="memory-entry-row"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="project-memory-legacy"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="refresh-project-memory"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="toggle-project-memory"]').text())
        .toBe('Enable memory')
    })

  it('shows no badge while the card is missing', async () => {
    const wrapper = await mountCard(null)

    expect(wrapper.find('[data-testid="project-memory-status"]').exists())
      .toBe(false)
  })

  it('explains an unavailable project and links to the API keys',
    async () => {
      const wrapper = await mountCard(createCard({
        memoryStatus: 'unavailable',
        memoryError: 'No usable key',
        total: 0,
        groups: [],
      }))
      const note = wrapper.get('[data-testid="project-memory-unavailable"]')

      expect(wrapper.get('[data-testid="project-memory-status"]').text())
        .toBe('Unavailable')
      expect(note.text()).toBe(
        'Project memory can\'t be built right now. Add a supported API key '
        + 'in Profile > API Keys, then refresh.',
      )
      expect(JSON.parse(note.get('a').attributes('data-to')!))
        .toBe('/profile/keys')
      expect(wrapper.get('[data-testid="project-memory-meta"]').text())
        .toContain('No usable key')
      expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
        .toBe(false)
    })

  it('keeps the standard empty text for failed and stale projects',
    async () => {
      for (const memoryStatus of ['failed', 'stale'] as const) {
        const wrapper = await mountCard(createCard({
          memoryStatus,
          total: 0,
          groups: [],
        }))

        expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
          .toBe(true)
        expect(wrapper.find('[data-testid="project-memory-unavailable"]')
          .exists()).toBe(false)
      }
    })

  it('renders nothing but the actions while the card is loading', async () => {
    const wrapper = await mountCard(null)

    expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="detail-modal-stub"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="refresh-project-memory"]').exists())
      .toBe(true)
  })

  describe('legacy memory', () => {
    const legacyMemory = [
      '**Purpose & Context**',
      '',
      'This memo covers the migration plan.',
      '',
      'Prefer additive schema changes.',
    ].join('\n')

    it('is absent when there is no legacy memory', async () => {
      const wrapper = await mountCard(createCard())

      expect(wrapper.find('[data-testid="project-memory-legacy"]').exists())
        .toBe(false)
    })

    it('is a collapsed read-only block under its heading', async () => {
      const wrapper = await mountCard(createCard({ legacyMemory }))
      const legacy = wrapper.get('[data-testid="project-memory-legacy"]')

      expect(legacy.element.tagName).toBe('DETAILS')
      expect(legacy.attributes('open')).toBeUndefined()
      expect(legacy.get('summary').text())
        .toBe('Earlier project memory (not converted yet)')
      expect(legacy.classes()).toContain('rounded-box')
    })

    it('is shown next to a convert hint instead of the empty state',
      async () => {
        const wrapper = await mountCard(createCard({
          memoryStatus: 'idle',
          total: 0,
          groups: [],
          legacyMemory,
        }))

        expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="project-memory-status"]').exists())
          .toBe(false)
        expect(wrapper.get('[data-testid="project-memory-unconverted"]').text())
          .toBe(
            'Nothing converted into entries yet. Refresh memory to turn the '
            + 'earlier memory below into entries.',
          )
        expect(wrapper.find('[data-testid="project-memory-legacy"]').exists())
          .toBe(true)
      })

    it('hides the convert hint while refreshing', async () => {
      const wrapper = await mountCard(createCard({
        memoryStatus: 'refreshing',
        total: 0,
        groups: [],
        legacyMemory,
      }))

      expect(wrapper.find('[data-testid="project-memory-unconverted"]')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
        .toBe(false)
    })

    it('treats a blank legacy memory as empty', async () => {
      const wrapper = await mountCard(createCard({
        memoryStatus: 'idle',
        total: 0,
        groups: [],
        legacyMemory: '  \n ',
      }))

      expect(wrapper.find('[data-testid="project-memory-empty"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="project-memory-status"]').text())
        .toBe('Empty')
    })

    it('renders every paragraph as its own block', async () => {
      const wrapper = await mountCard(createCard({ legacyMemory }))

      await vi.waitFor(() => {
        expect(
          wrapper.findAll('[data-testid="project-memory-legacy"] .chat-markdown p')
            .length,
        ).toBeGreaterThanOrEqual(3)
      })

      expect(
        wrapper.findAll('[data-testid="project-memory-legacy"] .chat-markdown p')
          .map(paragraph => paragraph.text()),
      ).toEqual([
        'Purpose & Context',
        'This memo covers the migration plan.',
        'Prefer additive schema changes.',
      ])
    })

    it('does not unwrap paragraphs in the markdown renderer', async () => {
      const wrapper = await mountSuspended(MemoryCard, {
        props: {
          projectId: 'project-1',
          card: createCard({ legacyMemory }),
          isRefreshing: false,
          isToggling: false,
        },
        global: {
          stubs: {
            UiBubble: { template: '<div><slot /></div>' },
            LazyProfileMemoryEntriesDetailModal: DetailModalStub,
            MDCCached: {
              name: 'MDCCached',
              props: ['value', 'unwrap', 'components'],
              template: '<div>{{ value }}</div>',
            },
          },
        },
      })
      const markdown = wrapper.findComponent({ name: 'MDCCached' })

      expect(markdown.exists()).toBe(true)
      expect(markdown.props('unwrap')).toBeUndefined()
      expect(markdown.props('value')).toBe(legacyMemory)
    })

    it('renders with the message components incl. the link confirm gate',
      async () => {
        const { messageComponents, imageComponents } = useChatFormat()
        const wrapper = await mountSuspended(MemoryCard, {
          props: {
            projectId: 'project-1',
            card: createCard({ legacyMemory }),
            isRefreshing: false,
            isToggling: false,
          },
          global: {
            stubs: {
              UiBubble: { template: '<div><slot /></div>' },
              LazyProfileMemoryEntriesDetailModal: DetailModalStub,
              MDCCached: {
                name: 'MDCCached',
                props: ['components'],
                template: '<div />',
              },
            },
          },
        })
        const components = wrapper.findComponent({ name: 'MDCCached' })
          .props('components')

        expect(components).toBe(messageComponents)
        expect(components).toHaveProperty('a')
        expect(components.img).toBe(imageComponents.img)
      })
  })

  describe('actions', () => {
    it('emits refresh and toggle', async () => {
      const wrapper = await mountCard(createCard())

      expect(wrapper.get('[data-testid="toggle-project-memory"]').text())
        .toBe('Disable memory')

      await wrapper.get('[data-testid="refresh-project-memory"]')
        .trigger('click')
      await wrapper.get('[data-testid="toggle-project-memory"]')
        .trigger('click')

      expect(wrapper.emitted('refresh')).toEqual([[]])
      expect(wrapper.emitted('toggle')).toEqual([[]])
    })

    it('disables both buttons and spins while refreshing', async () => {
      const wrapper = await mountCard(createCard(), { isRefreshing: true })
      const refresh = wrapper.get('[data-testid="refresh-project-memory"]')

      expect(refresh.attributes('disabled')).toBeDefined()
      expect(refresh.find('.loading').exists()).toBe(true)
      expect(refresh.get('.loading').classes()).toContain('size-4')
      expect(refresh.get('.loading').classes()).not.toContain('loading-xs')
      expect(wrapper.get('[data-testid="toggle-project-memory"]')
        .attributes('disabled')).toBeDefined()
    })

    it('disables both buttons and spins while toggling', async () => {
      const wrapper = await mountCard(createCard(), { isToggling: true })
      const toggle = wrapper.get('[data-testid="toggle-project-memory"]')

      expect(toggle.attributes('disabled')).toBeDefined()
      expect(toggle.find('.loading').exists()).toBe(true)
      expect(toggle.get('.loading').classes()).toContain('size-4')
      expect(toggle.get('.loading').classes()).not.toContain('loading-xs')
      expect(wrapper.get('[data-testid="refresh-project-memory"]')
        .attributes('disabled')).toBeDefined()
    })

    it('links to the project scope of the Memory tab', async () => {
      const wrapper = await mountCard(createCard())
      const link = wrapper.get('[data-testid="manage-project-memory-entries"]')

      expect(link.text()).toBe('Open in Memory')
      expect(JSON.parse(link.attributes('data-to')!)).toEqual({
        path: '/profile/memory',
        query: { scope: 'project', project: 'project-1' },
      })
    })
  })

  describe('account memory', () => {
    it('renders the toggle on by default with its description', async () => {
      const wrapper = await mountCard(createCard())
      const toggle = wrapper.get('[data-testid="project-memory-account-toggle"]')

      expect((toggle.element as HTMLInputElement).checked).toBe(true)
      expect(toggle.classes()).toContain('toggle')
      expect(wrapper.get('[data-testid="project-memory-account"]').text())
        .toContain('Use account memory')
      expect(wrapper.get('[data-testid="project-memory-account"]').text())
        .toContain('chats outside of projects')
    })

    it('reflects an isolated project', async () => {
      const wrapper = await mountCard(createCard({ useAccountMemory: false }))
      const toggle = wrapper.get('[data-testid="project-memory-account-toggle"]')

      expect((toggle.element as HTMLInputElement).checked).toBe(false)
    })

    it('emits the new value when toggled', async () => {
      const wrapper = await mountCard(createCard())

      await wrapper.get('[data-testid="project-memory-account-toggle"]')
        .setValue(false)

      expect(wrapper.emitted('update-account-memory')).toEqual([[false]])
    })

    it('disables the toggle while saving', async () => {
      const wrapper = await mountCard(createCard(), {
        isSavingAccountMemory: true,
      })

      expect(wrapper.get('[data-testid="project-memory-account-toggle"]')
        .attributes('disabled')).toBeDefined()
    })

    it('links to the account memory page', async () => {
      const wrapper = await mountCard(createCard())
      const link = wrapper.get('[data-testid="view-account-memory"]')

      expect(link.text()).toBe('View account memory')
      expect(JSON.parse(link.attributes('data-to')!)).toBe('/profile/memory')
    })

    it('stacks under sm and sits above the footer buttons', async () => {
      const wrapper = await mountCard(createCard())
      const account = wrapper.get('[data-testid="project-memory-account"]')
      const refresh = wrapper.get('[data-testid="refresh-project-memory"]')

      expect(account.classes()).toContain('flex-col')
      expect(account.classes()).toContain('sm:flex-row')
      expect(account.element.compareDocumentPosition(refresh.element)
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('is absent while the card is loading', async () => {
      const wrapper = await mountCard(null)

      expect(wrapper.find('[data-testid="project-memory-account"]').exists())
        .toBe(false)
    })
  })
})
