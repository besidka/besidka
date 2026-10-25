import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../../../../../shared/types/memory.d'
import type { MemoryProjectSection } from '../../../../../../app/types/memory-entries.d'
import Projects from '../../../../../../app/components/Profile/Memory/Entries/Projects.vue'

enableAutoUnmount(afterEach)

function createEntry(id: string, projectId: string): MemoryEntry {
  return {
    id,
    projectId,
    category: 'topics',
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
  }
}

const projects: MemoryProjectSection[] = [
  {
    id: 'project-1',
    name: 'Home lab',
    isMemoryOff: true,
    isArchived: false,
    entries: [createEntry('a1', 'project-1'), createEntry('a2', 'project-1')],
  },
  {
    id: 'project-2',
    name: 'Side project',
    isMemoryOff: false,
    isArchived: true,
    entries: [createEntry('b1', 'project-2')],
  },
]

async function mountProjects(focusProjectId: string | null = null) {
  const wrapper = await mountSuspended(Projects, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
        },
      },
    },
    props: { projects, limit: 15, focusProjectId },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Memory/Entries/Projects', () => {
  it('labels the section with a heading and the project count', async () => {
    const wrapper = await mountProjects()
    const section = wrapper.get('[data-testid="memory-projects"]')
    const heading = section.get('h3 > span')

    expect(heading.text()).toBe('Projects')
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(wrapper.get('[data-testid="memory-projects-count"]').text())
      .toBe('2')
  })

  it('renders one collapsed row per project in the given order', async () => {
    const wrapper = await mountProjects()
    const rows = wrapper.findAll('[data-testid="memory-project"]')

    expect(rows.map(row => row.attributes('data-project-id')))
      .toEqual(['project-1', 'project-2'])
    expect(rows.map(row => row.get('[data-testid="memory-project-count"]')
      .text())).toEqual(['2 of 15', '1 of 15'])
    expect(rows.map(row => row.get('[data-testid="memory-project-toggle"]')
      .attributes('aria-expanded'))).toEqual(['false', 'false'])
    expect(wrapper.findAll('[data-testid="memory-entry-row"]')).toHaveLength(0)
  })

  it('marks only the memory-off project', async () => {
    const wrapper = await mountProjects()
    const rows = wrapper.findAll('[data-testid="memory-project"]')

    expect(rows[0]!.find('[data-testid="memory-project-off"]').exists())
      .toBe(true)
    expect(rows[1]!.find('[data-testid="memory-project-off"]').exists())
      .toBe(false)
  })

  it('marks only the archived project', async () => {
    const wrapper = await mountProjects()
    const rows = wrapper.findAll('[data-testid="memory-project"]')

    expect(rows[0]!.find('[data-testid="memory-project-archived"]').exists())
      .toBe(false)
    expect(rows[1]!.get('[data-testid="memory-project-archived"]').text())
      .toBe('Archived')
  })

  it('expands only the project that was asked for', async () => {
    const wrapper = await mountProjects('project-2')
    const toggles = wrapper.findAll('[data-testid="memory-project-toggle"]')

    expect(toggles.map(toggle => toggle.attributes('aria-expanded')))
      .toEqual(['false', 'true'])
    expect(document.activeElement).toBe(toggles[1]!.element)
    expect(wrapper.emitted('focused')).toHaveLength(1)
  })

  it('forwards select, add and changed from a project', async () => {
    const wrapper = await mountProjects('project-1')

    await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')
    await wrapper.get('[data-testid="memory-project-add"]').trigger('click')

    expect(wrapper.emitted('select')![0]).toEqual([
      expect.objectContaining({ id: 'a1' }),
    ])
    expect(wrapper.emitted('add')).toEqual([['project-1']])
  })
})
