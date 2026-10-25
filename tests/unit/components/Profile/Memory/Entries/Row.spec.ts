import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../../../../../shared/types/memory.d'
import Row from '../../../../../../app/components/Profile/Memory/Entries/Row.vue'

enableAutoUnmount(afterEach)

const DAY_IN_MS = 24 * 60 * 60 * 1000

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    projectId: null,
    category: 'preferences',
    slug: 'short-answers',
    title: 'Prefers short answers',
    description: 'Keeps replies brief and skips the preamble.',
    body: 'Likes short answers.',
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

async function mountRow(overrides: Partial<MemoryEntry> = {}) {
  return await mountSuspended(Row, {
    props: { entry: createEntry(overrides) },
  })
}

describe('Profile/Memory/Entries/Row', () => {
  it('is a full-width button', async () => {
    const wrapper = await mountRow()
    const row = wrapper.get('[data-testid="memory-entry-row"]')

    expect(row.element.tagName).toBe('BUTTON')
    expect(row.attributes('type')).toBe('button')
    expect(row.classes()).toContain('w-full')
  })

  it('shows the title and one-line description', async () => {
    const wrapper = await mountRow()

    expect(wrapper.text()).toContain('Prefers short answers')
    expect(wrapper.text()).toContain(
      'Keeps replies brief and skips the preamble.',
    )
    expect(wrapper.find('.truncate').text()).toBe('Prefers short answers')
    expect(wrapper.find('.line-clamp-1').exists()).toBe(true)
  })

  it('shows when it was updated and where it came from', async () => {
    const wrapper = await mountRow()

    expect(wrapper.get('[data-testid="memory-entry-meta"]').text())
      .toBe('Updated just now · Saved in chat')
  })

  it('words the age without the chat activity prefix', async () => {
    const wrapper = await mountRow({
      origin: 'extraction',
      updatedAt: new Date(Date.now() - (3 * DAY_IN_MS)).toISOString(),
    })

    expect(wrapper.get('[data-testid="memory-entry-meta"]').text())
      .toBe('Updated 3 days ago · Extracted from chats')
  })

  it.each([
    ['user', 'You'],
    ['tool', 'Saved in chat'],
    ['extraction', 'Extracted from chats'],
    ['import', 'Imported'],
  ] as const)('labels the %s origin', async (origin, label) => {
    const wrapper = await mountRow({ origin })

    expect(wrapper.get('[data-testid="memory-entry-meta"]').text())
      .toContain(label)
  })

  it('never renders a sensitive badge, even for special entries',
    async () => {
      const wrapper = await mountRow({
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      expect(wrapper.find('[data-testid="memory-entry-sensitive"]').exists())
        .toBe(false)
      expect(wrapper.text()).not.toContain('Sensitive')
    })

  it('emits the entry when clicked', async () => {
    const wrapper = await mountRow()

    await wrapper.get('[data-testid="memory-entry-row"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[expect.objectContaining({ id: 'entry-1' })]])
  })
})
