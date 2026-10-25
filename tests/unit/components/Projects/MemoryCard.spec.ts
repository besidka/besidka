import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MemoryCard from '../../../../app/components/Projects/MemoryCard.vue'

vi.mock('#app', async (importOriginal) => {
  return await importOriginal<Record<string, unknown>>()
})

describe('Projects/MemoryCard', () => {
  it('renders ready memory without a ready badge and emits refresh', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        projectId: 'project-1',
        memory: 'Prefers concise implementation notes and TypeScript examples.',
        memoryStatus: 'ready',
        memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
        memoryProvider: 'google',
        memoryModel: 'gemini-2.5-flash-lite',
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div>{{ value }}</div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Project memory')
    expect(wrapper.text()).toContain('TypeScript examples')
    expect(wrapper.text()).toContain('Disable memory')
    expect(wrapper.text()).not.toContain('Ready')

    await wrapper.get('[data-testid="refresh-project-memory"]').trigger('click')

    expect(wrapper.emitted('refresh')).toEqual([[]])
  })

  it('renders disabled state with enable action', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        projectId: 'project-1',
        memory: null,
        memoryStatus: 'disabled',
        memoryUpdatedAt: null,
        memoryProvider: null,
        memoryModel: null,
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div>{{ value }}</div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Disabled')
    expect(wrapper.text()).toContain(
      'Project memory is disabled for this project.',
    )
    expect(wrapper.text()).toContain('Enable memory')
    expect(wrapper.find('[data-testid="refresh-project-memory"]').exists()).toBe(false)

    await wrapper.get('[data-testid="toggle-project-memory"]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[]])
  })

  it('renders empty state guidance for instruction-only projects', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        projectId: 'project-1',
        memory: null,
        memoryStatus: 'idle',
        memoryUpdatedAt: null,
        memoryProvider: 'google',
        memoryModel: 'gemini-3.1-flash-lite',
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div>{{ value }}</div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Empty')
    expect(wrapper.text()).toContain(
      'No reusable project memory was found.',
    )
    expect(wrapper.text()).toContain('keeping memory disabled is often better')
    expect(wrapper.text()).not.toContain('Model: google')
  })

  it('links to the project scope of the memory entries list', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        projectId: 'project-1',
        memory: null,
        memoryStatus: 'idle',
        memoryUpdatedAt: null,
        memoryProvider: null,
        memoryModel: null,
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          NuxtLink: {
            props: ['to'],
            template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div>{{ value }}</div>',
          },
        },
      },
    })
    const link = wrapper.get('[data-testid="manage-project-memory-entries"]')

    expect(link.text()).toBe('Manage memory entries')
    expect(JSON.parse(link.attributes('data-to')!)).toEqual({
      path: '/profile/memory',
      query: { scope: 'project', project: 'project-1' },
    })
  })

  it('hides the entries link until the project id is known', async () => {
    const wrapper = await mountSuspended(MemoryCard, {
      props: {
        memory: null,
        memoryStatus: 'idle',
        memoryUpdatedAt: null,
        memoryProvider: null,
        memoryModel: null,
        memoryError: null,
        isRefreshing: false,
        isToggling: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
          MDCCached: {
            props: ['value'],
            template: '<div>{{ value }}</div>',
          },
        },
      },
    })

    expect(wrapper.find('[data-testid="manage-project-memory-entries"]')
      .exists()).toBe(false)
  })

  describe('multi-paragraph memory', () => {
    const multiParagraphMemory = [
      '**Purpose & Context**',
      '',
      'This memo covers the migration plan.',
      '',
      '**Key Learnings**',
      '',
      'Prefer additive schema changes.',
    ].join('\n')

    const props = {
      memory: multiParagraphMemory,
      memoryStatus: 'ready' as const,
      memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
      memoryProvider: 'google',
      memoryModel: 'gemini-2.5-flash-lite',
      memoryError: null,
      isRefreshing: false,
      isToggling: false,
    }

    it('renders every markdown paragraph as its own block element', async () => {
      const wrapper = await mountSuspended(MemoryCard, {
        props,
        global: {
          stubs: {
            UiBubble: {
              template: '<div><slot /></div>',
            },
          },
        },
      })

      await flushPromises()
      await vi.waitFor(() => {
        expect(
          wrapper.findAll('.chat-markdown p').length,
        ).toBeGreaterThanOrEqual(4)
      })

      const paragraphTexts = wrapper
        .findAll('.chat-markdown p')
        .map(paragraph => paragraph.text())

      expect(paragraphTexts).toEqual([
        'Purpose & Context',
        'This memo covers the migration plan.',
        'Key Learnings',
        'Prefer additive schema changes.',
      ])
    })

    it('does not strip paragraph wrappers from the memory markdown', async () => {
      const wrapper = await mountSuspended(MemoryCard, {
        props,
        global: {
          stubs: {
            UiBubble: {
              template: '<div><slot /></div>',
            },
            MDCCached: {
              name: 'MDCCached',
              props: ['value', 'unwrap'],
              template: '<div>{{ value }}</div>',
            },
          },
        },
      })

      const markdown = wrapper.findComponent({ name: 'MDCCached' })

      expect(markdown.exists()).toBe(true)
      expect(markdown.props('unwrap')).toBeUndefined()
      expect(markdown.props('value')).toBe(multiParagraphMemory)
    })
  })
})
