import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryEntry } from '../../../../../../shared/types/memory.d'
import type { MemoryEntryLimits } from '../../../../../../shared/types/memory-api.d'
import DetailModal from '../../../../../../app/components/Profile/Memory/Entries/DetailModal.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const limits: MemoryEntryLimits = {
  maxAccountEntries: 30,
  maxProjectEntries: 15,
  maxBodyBytes: 40,
  maxAlwaysInjectedBodyBytes: 20,
  maxDescriptionChars: 30,
  maxTitleChars: 20,
}

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    projectId: null,
    category: 'topics',
    slug: 'espresso',
    title: 'Espresso setup',
    description: 'Prefers a double shot',
    body: 'Line one\nLine two <b>bold</b>',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'extraction',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
    ...overrides,
  }
}

function createRejection() {
  return Object.assign(new Error('Request failed'), {
    data: {
      statusCode: 422,
      message: 'Memory rejected',
      data: {
        why: 'It looks like a payment card number.',
        fix: 'Remove the number and try again.',
      },
    },
  })
}

async function mountModal(entry: MemoryEntry | null = createEntry()) {
  const wrapper = await mountSuspended(DetailModal, {
    props: {
      entry,
      limits,
      open: false,
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountModal>>

function byTestId(wrapper: Wrapper, testId: string) {
  return wrapper.get(`[data-testid="${testId}"]`)
}

function isDisabled(wrapper: Wrapper, testId: string): boolean {
  return byTestId(wrapper, testId).classes().includes('btn-disabled')
}

async function startEditing(wrapper: Wrapper) {
  await byTestId(wrapper, 'memory-entry-edit').trigger('click')
  await flushPromises()
}

describe('Profile/Memory/Entries/DetailModal', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.info.mockReset()
    mocks.error.mockReset()
    mocks.fetch.mockResolvedValue({ chats: [] })
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('view mode', () => {
    it('opens the dialog and renders the entry as plain text', async () => {
      const wrapper = await mountModal()

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      expect(byTestId(wrapper, 'memory-entry-title').text())
        .toBe('Espresso setup')
      expect(byTestId(wrapper, 'memory-entry-description').text())
        .toBe('Prefers a double shot')
      expect(byTestId(wrapper, 'memory-entry-category').text())
        .toBe('Topics')
      expect(byTestId(wrapper, 'memory-entry-origin').text())
        .toBe('Extracted from chats')
      expect(byTestId(wrapper, 'memory-entry-meta').text())
        .toContain('Updated just now')

      const body = byTestId(wrapper, 'memory-entry-body')

      expect(body.text()).toBe('Line one\nLine two <b>bold</b>')
      expect(body.find('b').exists()).toBe(false)
      expect(body.classes()).toContain('whitespace-pre-wrap')
    })

    it('never renders a sensitive badge, even for special entries',
      async () => {
        const wrapper = await mountModal(createEntry({
          sensitivity: 'special',
          sensitiveCategory: 'health',
        }))

        expect(wrapper.find('[data-testid="memory-entry-sensitive"]').exists())
          .toBe(false)
        expect(byTestId(wrapper, 'memory-entry-view').text())
          .not.toContain('Sensitive')
      })

    it('offers Edit and Delete in the footer', async () => {
      const wrapper = await mountModal()

      expect(byTestId(wrapper, 'memory-entry-edit').text()).toContain('Edit')
      expect(byTestId(wrapper, 'memory-entry-delete').text())
        .toContain('Delete')
    })

    it('renders nothing but the shell without an entry', async () => {
      const wrapper = await mountModal(null)

      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(false)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  })

  describe('sources', () => {
    it('says so when the entry has no source chats', async () => {
      const wrapper = await mountModal()

      expect(byTestId(wrapper, 'memory-entry-sources-empty').text())
        .toBe('Not tied to a specific chat.')
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('fetches sources once per opened entry and links the chats',
      async () => {
        mocks.fetch.mockResolvedValue({
          chats: [
            { id: 'chat-1', slug: 'first-chat', title: 'First chat' },
            { id: 'chat-2', slug: 'second-chat', title: '' },
          ],
        })

        const wrapper = await mountModal(createEntry({
          sourceChatIds: ['chat-1', 'chat-2', 'chat-3'],
        }))

        expect(mocks.fetch).toHaveBeenCalledOnce()
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/memory/entries/entry-1/sources',
        )

        const links = wrapper.findAll(
          '[data-testid="memory-entry-source-link"]',
        )

        expect(links).toHaveLength(2)
        expect(links[0]!.attributes('to')).toBe('/chats/first-chat')
        expect(links[0]!.text()).toBe('First chat')
        expect(links[1]!.attributes('to')).toBe('/chats/second-chat')
        expect(links[1]!.text()).toBe('Untitled chat')
        expect(byTestId(wrapper, 'memory-entry-sources-missing').text())
          .toBe('1 source chat no longer exists.')

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-cancel').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledOnce()
      })

    it('pluralizes the missing sources note', async () => {
      mocks.fetch.mockResolvedValue({ chats: [] })

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1', 'chat-2'],
      }))

      expect(byTestId(wrapper, 'memory-entry-sources-missing').text())
        .toBe('2 source chats no longer exist.')
    })

    it('shows a skeleton while the sources load', async () => {
      mocks.fetch.mockReturnValue(new Promise(() => {}))

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1'],
      }))

      expect(wrapper.find('[data-testid="memory-entry-sources-skeleton"]')
        .exists()).toBe(true)
    })

    it('shows a sources failure inline', async () => {
      mocks.fetch.mockRejectedValue(createRejection())

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1'],
      }))

      const alert = byTestId(wrapper, 'memory-entry-sources-error')

      expect(alert.text()).toContain('Memory rejected')
      expect(alert.text()).toContain('It looks like a payment card number.')
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('ignores a stale sources response for a previous entry', async () => {
      let resolveFirst: (value: unknown) => void = () => {}

      mocks.fetch
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveFirst = resolve
        }))
        .mockResolvedValueOnce({
          chats: [{ id: 'chat-b', slug: 'chat-b-slug', title: 'Chat B' }],
        })

      const wrapper = await mountModal(createEntry({
        id: 'entry-a',
        sourceChatIds: ['chat-a'],
      }))

      await wrapper.setProps({
        entry: createEntry({ id: 'entry-b', sourceChatIds: ['chat-b'] }),
      })
      await flushPromises()

      resolveFirst({
        chats: [{ id: 'chat-a', slug: 'chat-a-slug', title: 'Chat A' }],
      })
      await flushPromises()

      const links = wrapper.findAll(
        '[data-testid="memory-entry-source-link"]',
      )

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(links).toHaveLength(1)
      expect(links[0]!.text()).toBe('Chat B')
    })
  })

  describe('edit mode', () => {
    it('keeps Save disabled until a field changes', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)

      await byTestId(wrapper, 'memory-entry-title-input')
        .setValue('Espresso routine')

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
    })

    it('sends only the changed fields and shows the saved entry',
      async () => {
        mocks.fetch.mockResolvedValue({
          entry: createEntry({ title: 'Espresso routine' }),
        })

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-title-input')
          .setValue('  Espresso routine ')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledOnce()
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/memory/entries/entry-1',
          { method: 'PATCH', body: { title: 'Espresso routine' } },
        )
        expect(mocks.info).toHaveBeenCalledWith(
          'Saved',
          'Memory entry updated.',
        )
        expect(wrapper.emitted('changed')).toEqual([[
          { reason: 'saved', categoryChanged: false },
        ]])
        expect(wrapper.find('[data-testid="memory-entry-form"]').exists())
          .toBe(false)
        expect(byTestId(wrapper, 'memory-entry-title').text())
          .toBe('Espresso routine')
      })

    it('sends the category and body when they change', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-body-input').setValue('New body')
      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('people')
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'PATCH', body: { body: 'New body', category: 'people' } },
      )
    })

    it('reports a category change when the saved entry moves', async () => {
      mocks.fetch.mockResolvedValue({
        entry: createEntry({ category: 'people' }),
      })

      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('people')
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('changed')).toEqual([[
        { reason: 'saved', categoryChanged: true },
      ]])
    })

    it('strips newlines from the description', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal(createEntry({
        description: 'Likes\ndouble shots',
      }))

      await startEditing(wrapper)

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)

      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'PATCH', body: { description: 'Likes double shots' } },
      )
    })

    it('shows counters and disables Save over the title limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      expect(byTestId(wrapper, 'memory-entry-title-counter').text())
        .toBe('14 / 20')

      await byTestId(wrapper, 'memory-entry-title-input')
        .setValue('x'.repeat(21))

      const counter = byTestId(wrapper, 'memory-entry-title-counter')

      expect(counter.text()).toBe('21 / 20')
      expect(counter.classes()).toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('disables Save over the description limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-description-input')
        .setValue('x'.repeat(31))

      expect(byTestId(wrapper, 'memory-entry-description-counter').classes())
        .toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('counts body bytes against the general limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('é'.repeat(20))

      const counter = byTestId(wrapper, 'memory-entry-body-counter')

      expect(counter.text()).toContain('40 / 40')
      expect(counter.classes()).not.toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)

      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('é'.repeat(21))

      expect(byTestId(wrapper, 'memory-entry-body-counter').classes())
        .toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('uses the lower body limit for always-injected categories',
      async () => {
        const wrapper = await mountModal(createEntry({ category: 'profile' }))

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input')
          .setValue('x'.repeat(21))

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 20')
        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)

        await byTestId(wrapper, 'memory-entry-category-select')
          .setValue('topics')

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 40')
        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
      })

    it('disables Save when a field is empty', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-description-input')
        .setValue('   ')

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('shows a rejection inline without a toast and clears it on input',
      async () => {
        mocks.fetch.mockRejectedValue(createRejection())

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input').setValue('Card 1')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        const alert = byTestId(wrapper, 'memory-entry-error')

        expect(alert.attributes('role')).toBe('alert')
        expect(alert.text()).toContain('Memory rejected')
        expect(alert.text()).toContain('It looks like a payment card number.')
        expect(alert.text()).toContain('Remove the number and try again.')
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(wrapper.find('[data-testid="memory-entry-form"]').exists())
          .toBe(true)

        await byTestId(wrapper, 'memory-entry-body-input').setValue('Card 2')

        expect(wrapper.find('[data-testid="memory-entry-error"]').exists())
          .toBe(false)
      })

    it('renders a 422 rejection as message, why and fix without a toast',
      async () => {
        mocks.fetch.mockRejectedValue(Object.assign(new Error('Failed'), {
          data: {
            statusCode: 422,
            message: 'This looks like sensitive information',
            data: {
              why: 'Health details are not stored in memory.',
              fix: 'Remove that detail and save again.',
            },
          },
        }))

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input')
          .setValue('I manage a chronic condition')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        const alert = byTestId(wrapper, 'memory-entry-error')
        const lines = alert.findAll('p')

        expect(lines.map(line => line.text())).toEqual([
          'This looks like sensitive information',
          'Health details are not stored in memory.',
          'Remove that detail and save again.',
        ])
        expect(lines[0]!.classes()).toContain('font-bold')
        expect(lines.every(line => line.classes().includes('break-words')))
          .toBe(true)
        expect(alert.text()).not.toContain('422')
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
      })

    it('discards the draft on Cancel', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-title-input').setValue('Changed')
      await byTestId(wrapper, 'memory-entry-cancel').trigger('click')

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(byTestId(wrapper, 'memory-entry-title').text())
        .toBe('Espresso setup')

      await startEditing(wrapper)

      expect(
        (byTestId(wrapper, 'memory-entry-title-input')
          .element as HTMLInputElement).value,
      ).toBe('Espresso setup')
    })

    it('returns to view mode when the modal closes', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await wrapper.setProps({ open: false })
      await flushPromises()
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(true)
    })
  })

  it('shows the age without the activity prefix', async () => {
    const wrapper = await mountModal(createEntry({
      updatedAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString(),
    }))

    expect(byTestId(wrapper, 'memory-entry-meta').text())
      .toContain('Updated 3 days ago')
    expect(byTestId(wrapper, 'memory-entry-meta').text())
      .not.toContain('Last activity')
  })

  describe('delete', () => {
    it('deletes after confirmation, closes and emits changed', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
      mocks.fetch.mockResolvedValue({ success: true })

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Delete this memory?',
        subtitle: 'Besidka stops using it in chats. This cannot be undone.',
        alert: true,
        actions: ['Delete'],
        labelDecline: 'Cancel',
      })
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'DELETE' },
      )
      expect(mocks.info).toHaveBeenCalledWith(
        'Deleted',
        'Memory entry removed.',
      )
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
      expect(wrapper.emitted('changed')).toEqual([[
        { reason: 'deleted', categoryChanged: false },
      ]])
    })

    it('does nothing when the confirmation is declined', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('toasts a failed delete and keeps the modal open', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
      mocks.fetch.mockRejectedValue(createRejection())

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Memory rejected',
        'It looks like a payment card number.',
      )
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('update:open')).toBeUndefined()
      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(true)
    })
  })
})
