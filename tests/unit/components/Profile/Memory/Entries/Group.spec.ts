import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../../../../../shared/types/memory.d'
import Group from '../../../../../../app/components/Profile/Memory/Entries/Group.vue'

enableAutoUnmount(afterEach)

function createEntry(id: string, title: string): MemoryEntry {
  return {
    id,
    projectId: null,
    category: 'preferences',
    slug: id,
    title,
    description: `${title} description`,
    body: 'Body',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'user',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

const entries = [
  createEntry('entry-1', 'Prefers short answers'),
  createEntry('entry-2', 'Uses metric units'),
]

async function mountGroup() {
  return await mountSuspended(Group, {
    props: { category: 'preferences', entries },
  })
}

describe('Profile/Memory/Entries/Group', () => {
  it('names the section by its heading', async () => {
    const wrapper = await mountGroup()
    const section = wrapper.get('[data-testid="memory-entry-group"]')
    const heading = wrapper.get('h3')

    expect(section.element.tagName).toBe('SECTION')
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(heading.text()).toContain('Preferences')
  })

  it('shows the entry count', async () => {
    const wrapper = await mountGroup()

    expect(wrapper.get('[data-testid="memory-entry-group-count"]').text())
      .toBe('2')
  })

  it('lists every entry as a row in order', async () => {
    const wrapper = await mountGroup()
    const items = wrapper.findAll('ul > li')

    expect(items).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="memory-entry-row"]')
      .map(row => row.text()))
      .toEqual([
        expect.stringContaining('Prefers short answers'),
        expect.stringContaining('Uses metric units'),
      ])
  })

  it('forwards the selected entry', async () => {
    const wrapper = await mountGroup()

    await wrapper.findAll('[data-testid="memory-entry-row"]')[1]!
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([[entries[1]]])
  })
})
