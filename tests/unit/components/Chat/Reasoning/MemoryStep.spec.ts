import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import MemoryStep from '../../../../../app/components/Chat/Reasoning/MemoryStep.vue'
import * as messagesComposable from '../../../../../app/composables/messages'
import type {
  MemoryStepData,
} from '../../../../../app/types/memory-step.d'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

const previous = {
  category: 'areas',
  title: 'Job',
  description: 'Old description',
  body: 'Old body',
  sensitivity: 'none',
  sensitiveCategory: null,
} as const

function createData(overrides: Partial<MemoryStepData> = {}): MemoryStepData {
  return {
    toolName: 'memory_list',
    state: 'done',
    entries: [],
    errorReason: '',
    ...overrides,
  }
}

function createWriteData(
  overrides: Partial<MemoryStepData> = {},
): MemoryStepData {
  return createData({
    toolName: 'memory_write',
    action: 'created',
    entryId: 'entry-9',
    entries: [{
      id: 'entry-9',
      title: 'Anna',
      category: 'people',
      scope: 'account',
    }],
    ...overrides,
  })
}

async function mountStep(
  data: MemoryStepData,
  options: { title?: string, pending?: boolean } = {},
): Promise<VueWrapper> {
  return await mountSuspended(MemoryStep, {
    props: {
      data,
      title: options.title ?? 'Saved to memory',
      pending: options.pending ?? false,
    },
  })
}

function undoButton(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="reasoning-memory-step-undo"]')
}

async function flush(wrapper: VueWrapper) {
  await new Promise(resolve => setTimeout(resolve))
  await wrapper.vm.$nextTick()
}

describe('Chat/Reasoning/MemoryStep', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    vi.restoreAllMocks()
  })

  it('shows the title, the entry title and the Undo button for a save',
    async () => {
      const wrapper = await mountStep(createWriteData())

      expect(
        wrapper.get('[data-testid="reasoning-memory-step-title"]').text(),
      ).toBe('Saved to memory')
      expect(
        wrapper.get('[data-testid="reasoning-memory-step-entry-title"]')
          .text(),
      ).toBe('“Anna”')
      expect(
        wrapper.get('[data-testid="reasoning-memory-step-entry-category"]')
          .text(),
      ).toBe('People')

      const undo = undoButton(wrapper)

      expect(undo.exists()).toBe(true)
      expect(undo.text()).toBe('Undo')
      expect(undo.attributes('type')).toBe('button')
      expect(undo.classes()).toEqual(
        expect.arrayContaining(['btn', 'btn-ghost', 'btn-xs']),
      )
      expect(
        wrapper.get('[data-testid="reasoning-memory-step-trigger"]')
          .attributes('disabled'),
      ).toBeDefined()
    })

  it('names the Undo button after the saved entry', async () => {
    const wrapper = await mountStep(createWriteData())

    expect(undoButton(wrapper).attributes('aria-label'))
      .toBe('Undo saving "Anna" to memory')
  })

  it('falls back to a generic Undo name without an entry title', async () => {
    const wrapper = await mountStep(createWriteData({ entries: [] }))

    expect(undoButton(wrapper).attributes('aria-label'))
      .toBe('Undo saving to memory')
  })

  it('announces Undone in a polite live region', async () => {
    mocks.fetch.mockResolvedValue({ success: true })

    const wrapper = await mountStep(createWriteData())
    const status = () => {
      return wrapper.get('[data-testid="reasoning-memory-step-undo-status"]')
    }

    expect(status().attributes('aria-live')).toBe('polite')
    expect(status().text()).toBe('')

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(status().attributes('aria-live')).toBe('polite')
    expect(status().text()).toBe('Undone')
    expect(undoButton(wrapper).attributes('aria-label')).toBeUndefined()
  })

  it('announces Undone when the entry is already gone', async () => {
    mocks.fetch.mockRejectedValue({
      status: 404,
      statusCode: 404,
      data: { status: 404, message: 'Memory entry not found' },
    })

    const wrapper = await mountStep(createWriteData())

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(
      wrapper.get('[data-testid="reasoning-memory-step-undo-status"]').text(),
    ).toBe('Undone')
  })

  it('encodes the entry id in the DELETE and PATCH urls', async () => {
    mocks.fetch.mockResolvedValue({ success: true })

    const created = await mountStep(createWriteData({
      entryId: 'a/b?c#d',
    }))

    await undoButton(created).trigger('click')
    await flush(created)

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/memory/entries/a%2Fb%3Fc%23d',
      { method: 'DELETE' },
    )

    const updated = await mountStep(createWriteData({
      action: 'updated',
      entryId: 'a/b?c#d',
      previous: { ...previous },
    }))

    await undoButton(updated).trigger('click')
    await flush(updated)

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/memory/entries/a%2Fb%3Fc%23d',
      { method: 'PATCH', body: previous },
    )
  })

  it('deletes the entry when undoing a created save', async () => {
    mocks.fetch.mockResolvedValue({ success: true })

    const wrapper = await mountStep(createWriteData())

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/memory/entries/entry-9',
      { method: 'DELETE' },
    )
    expect(undoButton(wrapper).text()).toBe('Undone')
    expect(undoButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('patches the previous values when undoing an updated save',
    async () => {
      mocks.fetch.mockResolvedValue({ entry: {} })

      const wrapper = await mountStep(createWriteData({
        action: 'updated',
        previous: { ...previous },
      }))

      await undoButton(wrapper).trigger('click')
      await flush(wrapper)

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-9',
        { method: 'PATCH', body: previous },
      )
      expect(undoButton(wrapper).text()).toBe('Undone')
    })

  it('does not fire a second request once undone', async () => {
    mocks.fetch.mockResolvedValue({ success: true })

    const wrapper = await mountStep(createWriteData())

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)
    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('counts a 404 as already undone without an error toast', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    mocks.fetch.mockRejectedValue({
      status: 404,
      statusCode: 404,
      data: { status: 404, message: 'Memory entry not found' },
    })

    const wrapper = await mountStep(createWriteData())

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(undoButton(wrapper).text()).toBe('Undone')
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('reports other undo failures and keeps Undo available', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    mocks.fetch.mockRejectedValue({
      status: 409,
      statusCode: 409,
      data: {
        status: 409,
        message: 'An entry with this name already exists',
        why: 'Another entry uses it.',
      },
    })

    const wrapper = await mountStep(createWriteData({
      action: 'updated',
      previous: { ...previous },
    }))

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(useErrorMessage).toHaveBeenCalledWith(
      'An entry with this name already exists',
      'Another entry uses it.',
    )
    expect(undoButton(wrapper).text()).toBe('Undo')
    expect(undoButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('falls back to a generic undo error title', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    mocks.fetch.mockRejectedValue(new Error(''))

    const wrapper = await mountStep(createWriteData())

    await undoButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(useErrorMessage).toHaveBeenCalledTimes(1)
    expect(useErrorMessage.mock.calls[0]?.[0]).toBeTruthy()
  })

  it('hides Undo for an updated save without previous values', async () => {
    const wrapper = await mountStep(createWriteData({
      action: 'updated',
      previous: undefined,
    }))

    expect(undoButton(wrapper).exists()).toBe(false)
  })

  it('hides Undo while saving and after a failed save', async () => {
    const pending = await mountStep(
      createWriteData({ state: 'pending', entries: [], entryId: undefined }),
      { title: 'Saving to memory', pending: true },
    )
    const failed = await mountStep(
      createWriteData({
        state: 'failed',
        entries: [],
        entryId: undefined,
        errorReason: 'Memory limit reached',
      }),
      { title: 'Saving to memory failed' },
    )

    expect(undoButton(pending).exists()).toBe(false)
    expect(undoButton(failed).exists()).toBe(false)
  })

  it('shows a skeleton title with an ellipsis while pending', async () => {
    const wrapper = await mountStep(
      createData({ state: 'pending' }),
      { title: 'Looking through your memory', pending: true },
    )
    const title = wrapper.get('[data-testid="reasoning-memory-step-title"]')

    expect(title.classes()).toContain('skeleton')
    expect(title.text()).toBe('Looking through your memory…')
  })

  it('shows the removed entry for a forget without any Undo', async () => {
    const wrapper = await mountStep(
      createData({
        toolName: 'memory_forget',
        entries: [{
          id: 'entry-3',
          title: 'Chess',
          category: 'topics',
          scope: 'account',
        }],
      }),
      { title: 'Removed from memory' },
    )

    expect(
      wrapper.get('[data-testid="reasoning-memory-step-title"]').text(),
    ).toBe('Removed from memory')
    expect(
      wrapper.get('[data-testid="reasoning-memory-step-entry-title"]')
        .text(),
    ).toBe('“Chess”')
    expect(undoButton(wrapper).exists()).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('shows the count and expands a list of titles with categories',
    async () => {
      const wrapper = await mountStep(
        createData({
          entries: [
            {
              id: 'a',
              title: 'Gardening',
              category: 'topics',
              scope: 'account',
            },
            {
              id: 'b',
              title: 'Metric units',
              category: 'preferences',
              scope: 'project',
            },
          ],
        }),
        { title: 'Looked through your memory' },
      )

      expect(
        wrapper.get('[data-testid="reasoning-memory-step-count"]').text(),
      ).toBe('2 entries')
      expect(
        wrapper.find('[data-testid="reasoning-memory-step-entries"]')
          .exists(),
      ).toBe(false)

      await wrapper.get('[data-testid="reasoning-memory-step-trigger"]')
        .trigger('click')

      const rows = wrapper.findAll('li')

      expect(rows).toHaveLength(2)
      expect(rows[0]?.text()).toContain('Topics')
      expect(rows[0]?.text()).toContain('Gardening')
      expect(rows[1]?.text()).toContain('Preferences')
      expect(rows[1]?.text()).toContain('Metric units')
      expect(wrapper.find('a').exists()).toBe(false)
    })

  it('uses the singular for one entry and is not expandable when empty',
    async () => {
      const one = await mountStep(
        createData({
          toolName: 'memory_read',
          entries: [{
            id: 'a',
            title: 'Gardening',
            category: 'topics',
            scope: 'account',
          }],
        }),
        { title: 'Read a memory' },
      )
      const none = await mountStep(createData(), {
        title: 'Looked through your memory',
      })

      expect(
        one.get('[data-testid="reasoning-memory-step-count"]').text(),
      ).toBe('1 entry')
      expect(
        none.get('[data-testid="reasoning-memory-step-count"]').text(),
      ).toBe('No entries')
      expect(
        none.get('[data-testid="reasoning-memory-step-trigger"]')
          .attributes('disabled'),
      ).toBeDefined()
    })

  it('caps the visible list and reports the rest', async () => {
    const entries = Array.from({ length: 12 }, (_value, index) => {
      return {
        id: `id-${index}`,
        title: `Entry ${index}`,
        category: 'topics' as const,
        scope: 'account' as const,
      }
    })
    const wrapper = await mountStep(createData({ entries }), {
      title: 'Looked through your memory',
    })

    await wrapper.get('[data-testid="reasoning-memory-step-trigger"]')
      .trigger('click')

    expect(wrapper.findAll('li')).toHaveLength(11)
    expect(
      wrapper.get('[data-testid="reasoning-memory-step-more"]').text(),
    ).toBe('+2 more')
  })

  it('shows the failure reason when a failed lookup is expanded',
    async () => {
      const wrapper = await mountStep(
        createData({
          state: 'failed',
          errorReason: 'Memory is turned off.',
        }),
        { title: 'Memory lookup failed' },
      )

      expect(
        wrapper.find('[data-testid="reasoning-memory-step-count"]').exists(),
      ).toBe(false)

      await wrapper.get('[data-testid="reasoning-memory-step-trigger"]')
        .trigger('click')

      expect(
        wrapper.get('[data-testid="reasoning-memory-step-error"]').text(),
      ).toBe('Memory is turned off.')
      expect(
        wrapper.find('[data-testid="reasoning-memory-step-entries"]')
          .exists(),
      ).toBe(false)
    })
})
