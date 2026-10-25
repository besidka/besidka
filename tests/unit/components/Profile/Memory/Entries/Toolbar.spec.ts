import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../../shared/types/memory.d'
import Toolbar from '../../../../../../app/components/Profile/Memory/Entries/Toolbar.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  useLazyFetch: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: true,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

interface ToolbarProps {
  settings: MemorySettingsFields
  projectId: string | null
  total: number | null
  limit: number | null
}

async function mountToolbar(overrides: Partial<ToolbarProps> = {}) {
  return await mountSuspended(Toolbar, {
    props: {
      settings: defaultSettings,
      projectId: null,
      total: 4,
      limit: 30,
      ...overrides,
    },
  })
}

function createRejection(
  statusCode: number,
  message: string,
  why: string,
) {
  return Object.assign(new Error('Request failed'), {
    data: { statusCode, message, data: { why } },
  })
}

function mockApi(options: {
  history?: Record<string, unknown>
  extract?: Record<string, unknown> | Error
  reset?: Record<string, unknown> | Error
} = {}) {
  mocks.fetch.mockImplementation(async (url: string) => {
    const response = {
      '/api/v1/chats/history': options.history ?? {
        pinned: [],
        chats: [{ slug: 'latest-chat', activityAt: '2026-02-01T00:00:00Z' }],
        nextCursor: null,
      },
      '/api/v1/memory/extract-now': options.extract ?? {
        status: 'extracted',
        created: 2,
        updated: 1,
        deleted: 0,
        dropped: 0,
        model: null,
      },
      '/api/v1/memory/entries/reset': options.reset ?? { deleted: 3 },
    }[url]

    if (response instanceof Error) {
      throw response
    }

    return response
  })
}

function callsTo(url: string) {
  return mocks.fetch.mock.calls.filter(([calledUrl]) => calledUrl === url)
}

describe('Profile/Memory/Entries/Toolbar', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Delete entries', index: 0 })
    mocks.info.mockReset()
    mocks.error.mockReset()
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef({
        pinned: [],
        projects: [{ id: 'project-1', name: 'Home lab' }],
        nextCursor: null,
      }),
    })
    mockApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the count against the limit', async () => {
    const wrapper = await mountToolbar({ total: 4, limit: 30 })

    expect(wrapper.get('[data-testid="memory-entries-count"]').text())
      .toBe('4 of 30')
  })

  it('hides the count until the response is known', async () => {
    const wrapper = await mountToolbar({ total: null, limit: null })

    expect(wrapper.find('[data-testid="memory-entries-count"]').exists())
      .toBe(false)
  })

  it('links the export to the download route', async () => {
    const wrapper = await mountToolbar()
    const link = wrapper.get('[data-testid="memory-export"]')

    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('/api/v1/memory/export')
    expect(link.attributes('download')).toBeDefined()
  })

  it('emits the chosen project from the scope switch', async () => {
    const wrapper = await mountToolbar()

    await wrapper.get('[data-testid="memory-scope-select"]')
      .setValue('project-1')

    expect(wrapper.emitted('scopeChange')).toEqual([['project-1']])
  })

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'shows update now only when memory=%s and generation=%s',
    async (memoryEnabled, memoryExtractionEnabled, isVisible) => {
      const wrapper = await mountToolbar({
        settings: {
          ...defaultSettings,
          memoryEnabled,
          memoryExtractionEnabled,
        },
      })

      expect(wrapper.find('[data-testid="memory-update-now"]').exists())
        .toBe(isVisible)
      expect(wrapper.find('[data-testid="memory-update-now-note"]').exists())
        .toBe(isVisible)
    },
  )

  it('explains where update now reads from', async () => {
    const wrapper = await mountToolbar()

    expect(wrapper.get('[data-testid="memory-update-now-note"]').text())
      .toBe('Reads your latest chat and runs on your own API key.')
  })

  describe('update memory now', () => {
    it('extracts the most recent chat and reports the counts', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.fetch.mock.calls[0]).toEqual([
        '/api/v1/chats/history',
        { query: { limit: 1 } },
      ])
      expect(mocks.fetch.mock.calls[1]).toEqual([
        '/api/v1/memory/extract-now',
        { method: 'POST', body: { chatSlug: 'latest-chat' } },
      ])
      expect(mocks.info).toHaveBeenCalledWith(
        'Memory updated',
        'Added 2, updated 1, removed 0.',
      )
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('prefers a pinned chat with newer activity', async () => {
      mockApi({
        history: {
          pinned: [{ slug: 'pinned-chat', activityAt: '2026-03-01T00:00:00Z' }],
          chats: [{ slug: 'plain-chat', activityAt: '2026-02-01T00:00:00Z' }],
          nextCursor: null,
        },
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/extract-now')[0]![1].body)
        .toEqual({ chatSlug: 'pinned-chat' })
    })

    it('says so when there are no chats to read', async () => {
      mockApi({ history: { pinned: [], chats: [], nextCursor: null } })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/extract-now')).toHaveLength(0)
      expect(mocks.info).toHaveBeenCalledWith(
        'No chats to read yet',
        'Start a chat, then try again.',
      )
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('says nothing new when every count is zero', async () => {
      mockApi({
        extract: {
          status: 'extracted',
          created: 0,
          updated: 0,
          deleted: 0,
          dropped: 0,
          model: null,
        },
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.info).toHaveBeenCalledWith(
        'Memory updated',
        'Nothing new to remember.',
      )
    })

    it.each([
      ['skipped', 'too-short', 'Your latest chat is too short to learn from yet.'],
      ['skipped', 'no-user-text', 'Your latest chat has no messages to read yet.'],
      ['leased', undefined, 'Besidka is already updating memory from this chat.'],
      ['skipped', 'something-new', 'something-new'],
    ])(
      'explains a %s result with reason %s',
      async (status, reason, message) => {
        mockApi({
          extract: {
            status,
            reason,
            created: 0,
            updated: 0,
            deleted: 0,
            dropped: 0,
            model: null,
          },
        })

        const wrapper = await mountToolbar()

        await wrapper.get('[data-testid="memory-update-now"]')
          .trigger('click')
        await flushPromises()

        expect(mocks.info).toHaveBeenCalledWith('Memory not updated', message)
      },
    )

    it('shows an error when extraction fails', async () => {
      mockApi({
        extract: {
          status: 'failed',
          reason: 'Error:500',
          created: 0,
          updated: 0,
          deleted: 0,
          dropped: 0,
          model: null,
        },
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Failed to update memory.',
        'Besidka could not read your latest chat. Try again in a minute.',
      )
      expect(mocks.info).not.toHaveBeenCalled()
    })

    it.each([
      [
        409,
        'Memory extraction is turned off',
        'Extraction needs memory and automatic memory updates enabled.',
      ],
      [
        429,
        'Memory extraction already requested',
        'Extraction was requested less than a minute ago.',
      ],
      [404, 'Chat not found', 'The chat no longer exists.'],
      [500, 'Memory extraction failed', 'The model could not be reached.'],
    ])('shows a %s error toast', async (statusCode, message, why) => {
      mockApi({ extract: createRejection(statusCode, message, why) })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(message, why)
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('shows a spinner and blocks repeat clicks while running', async () => {
      let finishHistory: (value: unknown) => void = () => {}

      mocks.fetch.mockImplementation((url: string) => {
        if (url === '/api/v1/chats/history') {
          return new Promise((resolve) => {
            finishHistory = resolve
          })
        }

        return Promise.resolve({
          status: 'extracted',
          created: 0,
          updated: 0,
          deleted: 0,
        })
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')

      const runningButton = wrapper.get('[data-testid="memory-update-now"]')

      expect(runningButton.classes()).toContain('btn-disabled')
      expect(runningButton.text()).toContain('Updating...')
      expect(runningButton.find('.loading').exists()).toBe(true)

      finishHistory({
        pinned: [],
        chats: [{ slug: 'latest-chat', activityAt: '2026-02-01T00:00:00Z' }],
      })
      await flushPromises()

      const idleButton = wrapper.get('[data-testid="memory-update-now"]')

      expect(idleButton.classes()).not.toContain('btn-disabled')
      expect(idleButton.text()).toContain('Update memory now')
    })
  })

  describe('reset memory', () => {
    it('names the account scope in the confirmation', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Reset memory?',
        subtitle: 'This deletes every account memory entry. '
          + 'This cannot be undone.',
        alert: true,
        actions: ['Delete entries'],
        labelDecline: 'Cancel',
      })
    })

    it('names the project in the confirmation', async () => {
      const wrapper = await mountToolbar({ projectId: 'project-1' })

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.confirm.mock.calls[0]![0].subtitle).toBe(
        'This deletes every "Home lab" project memory entry. '
        + 'This cannot be undone.',
      )
    })

    it('falls back to a generic project name when it is unknown', async () => {
      const wrapper = await mountToolbar({ projectId: 'missing-project' })

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.confirm.mock.calls[0]![0].subtitle).toContain(
        'every project memory entry',
      )
    })

    it('does nothing when the confirmation is cancelled', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/entries/reset')).toHaveLength(0)
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('resets the account scope and reports the deleted count', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/entries/reset')).toEqual([[
        '/api/v1/memory/entries/reset',
        { method: 'POST', body: { scope: 'account' } },
      ]])
      expect(mocks.info).toHaveBeenCalledWith(
        'Memory reset',
        'Deleted 3 entries.',
      )
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('resets the project scope with its id', async () => {
      mockApi({ reset: { deleted: 1 } })

      const wrapper = await mountToolbar({ projectId: 'project-1' })

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/entries/reset')[0]![1].body)
        .toEqual({ scope: 'project', projectId: 'project-1' })
      expect(mocks.info).toHaveBeenCalledWith(
        'Memory reset',
        'Deleted 1 entry.',
      )
    })

    it('says when there was nothing to delete', async () => {
      mockApi({ reset: { deleted: 0 } })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.info).toHaveBeenCalledWith(
        'Memory reset',
        'Nothing to delete.',
      )
    })

    it('shows an error toast and keeps the list when it fails', async () => {
      mockApi({
        reset: createRejection(
          500,
          'Could not reset memory',
          'Database unavailable',
        ),
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Could not reset memory',
        'Database unavailable',
      )
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('is disabled when there are no entries', async () => {
      const wrapper = await mountToolbar({ total: 0 })
      const button = wrapper.get('[data-testid="memory-reset"]')

      expect(button.classes()).toContain('btn-disabled')

      await button.trigger('click')
      await flushPromises()

      expect(mocks.confirm).not.toHaveBeenCalled()
    })

    it('keeps export available when there are no entries', async () => {
      const wrapper = await mountToolbar({ total: 0 })

      expect(wrapper.find('[data-testid="memory-export"]').exists())
        .toBe(true)
    })
  })
})
