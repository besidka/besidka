import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  MemoryCategory,
  MemoryEntry,
} from '../../../../../../shared/types/memory.d'
import Essentials from '../../../../../../app/components/Profile/Memory/Entries/Essentials.vue'

enableAutoUnmount(afterEach)

function createEntry(id: string, category: MemoryCategory): MemoryEntry {
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
    origin: 'user',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

const entries = [
  createEntry('profile-1', 'profile'),
  createEntry('preferences-1', 'preferences'),
]

async function mountEssentials(props: {
  heading?: string
  entries?: MemoryEntry[]
  canAdd?: boolean
} = {}) {
  return await mountSuspended(Essentials, {
    props: { heading: 'You', entries, ...props },
  })
}

describe('Profile/Memory/Entries/Essentials', () => {
  it('names the section by its heading', async () => {
    const wrapper = await mountEssentials()
    const section = wrapper.get('[data-testid="memory-entry-essentials"]')
    const heading = wrapper.get('[data-testid="memory-entry-essentials-heading"]')

    expect(section.element.tagName).toBe('SECTION')
    expect(heading.text()).toBe('You')
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
  })

  it('uses the given heading', async () => {
    const wrapper = await mountEssentials({ heading: 'Essentials' })

    expect(wrapper.get('[data-testid="memory-entry-essentials-heading"]')
      .text()).toBe('Essentials')
  })

  it('lists each entry as a row labelled by its category in order',
    async () => {
      const wrapper = await mountEssentials()
      const rows = wrapper.findAll('[data-testid="memory-entry-row"]')

      expect(rows).toHaveLength(2)
      expect(rows.map((row) => {
        return row.get('[data-testid="memory-entry-label"]').text()
      })).toEqual(['Profile', 'Preferences'])
      expect(wrapper.get('[data-testid="memory-entry-group-count"]').text())
        .toBe('2')
    })

  it('forwards the selected entry', async () => {
    const wrapper = await mountEssentials()

    await wrapper.findAll('[data-testid="memory-entry-row"]')[1]!
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([[entries[1]]])
  })

  it('invites the user to add memory when empty and adding is allowed',
    async () => {
      const wrapper = await mountEssentials({ entries: [], canAdd: true })
      const cta = wrapper.get('[data-testid="memory-entry-essentials-empty"]')

      expect(cta.text()).toContain('Tell Besidka about yourself')
      expect(cta.classes()).toContain('rounded-box')
      expect(wrapper.find('[data-testid="memory-entry-row"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="memory-essentials-add"]')
        .trigger('click')

      expect(wrapper.emitted('add')).toHaveLength(1)
    })

  it('renders nothing when empty and adding is not offered', async () => {
    const wrapper = await mountEssentials({ entries: [], canAdd: false })

    expect(wrapper.find('[data-testid="memory-entry-essentials"]').exists())
      .toBe(false)
  })
})
