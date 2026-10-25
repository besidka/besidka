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
    expect(wrapper.get('.truncate').text()).toBe('Prefers short answers')
    expect(wrapper.get('.truncate').classes()).toContain('font-medium')
    expect(wrapper.get('[data-testid="memory-entry-description"]').classes())
      .toEqual(expect.arrayContaining([
        'line-clamp-2',
        'sm:line-clamp-1',
        'text-base-content/70',
      ]))
  })

  it('is a compact row card with the box radius', async () => {
    const wrapper = await mountRow()
    const row = wrapper.get('[data-testid="memory-entry-row"]')

    expect(row.classes()).toEqual(expect.arrayContaining([
      'bubble',
      'rounded-box',
      'p-3',
    ]))
    expect(row.classes()).not.toContain('p-4')
    expect(row.classes().some(name => name.includes('rounded-full')))
      .toBe(false)
  })

  it('shows only when it was updated, without the origin', async () => {
    const wrapper = await mountRow()
    const meta = wrapper.get('[data-testid="memory-entry-meta"]')

    expect(meta.text()).toBe('Updated just now')
    expect(meta.classes()).toContain('whitespace-nowrap')
    expect(wrapper.text()).not.toContain('Saved in chat')
  })

  it('words the age without the chat activity prefix', async () => {
    const wrapper = await mountRow({
      origin: 'extraction',
      updatedAt: new Date(Date.now() - (3 * DAY_IN_MS)).toISOString(),
    })

    expect(wrapper.get('[data-testid="memory-entry-meta"]').text())
      .toBe('Updated 3 days ago')
  })

  it.each([
    'user',
    'tool',
    'extraction',
    'import',
  ] as const)('keeps the %s origin out of the row', async (origin) => {
    const wrapper = await mountRow({ origin })

    expect(wrapper.text()).not.toContain('Extracted from chats')
    expect(wrapper.text()).not.toContain('Imported')
    expect(wrapper.get('[data-testid="memory-entry-meta"]').text())
      .toBe('Updated just now')
  })

  it('renders no label badge by default', async () => {
    const wrapper = await mountRow()

    expect(wrapper.find('[data-testid="memory-entry-label"]').exists())
      .toBe(false)
  })

  it('renders the category label before the title when given', async () => {
    const wrapper = await mountSuspended(Row, {
      props: { entry: createEntry(), label: 'Preferences' },
    })

    expect(wrapper.get('[data-testid="memory-entry-label"]').text())
      .toBe('Preferences')
    expect(wrapper.get('.truncate').text()).toBe('Prefers short answers')
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
