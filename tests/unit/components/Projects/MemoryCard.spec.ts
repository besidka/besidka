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
  props: ['open', 'entry', 'limits'],
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
  props: { isRefreshing?: boolean, isToggling?: boolean } = {},
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
  it('renders the title, the hint and no badge when ready', async () => {
    const wrapper = await mountCard(createCard())

    expect(wrapper.text()).toContain('Project memory')
    expect(wrapper.text()).toContain(
      'Projects keep their memory up to date automatically; turn it off per '
      + 'project.',
    )
    expect(wrapper.find('[data-testid="project-memory-status"]').exists())
      .toBe(false)
  })

  it('shows the model, the updated age and the error label', async () => {
    const wrapper = await mountCard(createCard({
      memoryStatus: 'stale',
      memoryError: 'Hit the per-run cap',
    }))
    const meta = wrapper.get('[data-testid="project-memory-meta"]')

    expect(wrapper.get('[data-testid="project-memory-status"]').text())
      .toBe('Stale')
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

      expect(groups.map(group => group.attributes('data-category')))
        .toEqual(['preferences', 'topics'])
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

  it('closes the modal when it updates its open model', async () => {
    const wrapper = await mountCard(createCard())

    await wrapper.findAll('[data-testid="memory-entry-row"]')[0]!
      .trigger('click')
    await wrapper.getComponent(DetailModalStub).vm.$emit('update:open', false)

    expect(wrapper.get('[data-testid="detail-modal-stub"]')
      .attributes('data-open')).toBe('false')
  })

  it('shows the empty state when nothing is remembered', async () => {
    const wrapper = await mountCard(createCard({
      memoryStatus: 'idle',
      total: 0,
      groups: [],
    }))

    expect(wrapper.get('[data-testid="project-memory-status"]').text())
      .toBe('Empty')
    expect(wrapper.get('[data-testid="project-memory-empty"]').text())
      .toBe(
        'Nothing remembered for this project yet. Memory builds up from this '
        + 'project\'s chats.',
      )
    expect(wrapper.find('[data-testid="project-memory-count"]').exists())
      .toBe(false)
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
      expect(wrapper.get('[data-testid="toggle-project-memory"]')
        .attributes('disabled')).toBeDefined()
    })

    it('disables both buttons and spins while toggling', async () => {
      const wrapper = await mountCard(createCard(), { isToggling: true })
      const toggle = wrapper.get('[data-testid="toggle-project-memory"]')

      expect(toggle.attributes('disabled')).toBeDefined()
      expect(toggle.find('.loading').exists()).toBe(true)
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
})
