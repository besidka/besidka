import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../../shared/types/memory.d'
import Toolbar from '../../../../../../app/components/Profile/Memory/Entries/Toolbar.vue'

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

function createSheetStub(name: string, testId: string) {
  return defineComponent({
    name,
    props: ['open'],
    emits: ['update:open', 'changed'],
    setup(props) {
      return () => h('div', {
        'data-testid': testId,
        'data-open': String(props.open),
      })
    },
  })
}

const BackfillSheetStub = createSheetStub(
  'BackfillSheetStub',
  'stub-backfill-sheet',
)
const ImportSheetStub = createSheetStub(
  'ImportSheetStub',
  'stub-import-sheet',
)

const sheetStubs = {
  LazyProfileMemoryEntriesBackfillSheet: BackfillSheetStub,
  ProfileMemoryEntriesBackfillSheet: BackfillSheetStub,
  LazyProfileMemoryEntriesImportSheet: ImportSheetStub,
  ProfileMemoryEntriesImportSheet: ImportSheetStub,
}

interface ToolbarProps {
  settings: MemorySettingsFields
  total: number | null
  limit: number | null
}

async function mountToolbar(
  overrides: Partial<ToolbarProps> = {},
  slots: Record<string, () => unknown> = {},
) {
  return await mountSuspended(Toolbar, {
    props: {
      settings: defaultSettings,
      total: 4,
      limit: 30,
      ...overrides,
    },
    slots,
    global: { stubs: sheetStubs },
  })
}

type Wrapper = Awaited<ReturnType<typeof mountToolbar>>

function visibleLabel(wrapper: Wrapper, buttonTestId: string): string {
  const labels = [
    wrapper.get(`[data-testid="${buttonTestId}-idle-label"]`),
    wrapper.get(`[data-testid="${buttonTestId}-busy-label"]`),
  ].filter((label) => {
    return !label.classes().includes('invisible')
  })

  expect(labels).toHaveLength(1)

  return labels[0]!.text()
}

function sheetOpen(wrapper: Wrapper, testId: string): string | undefined {
  return wrapper.get(`[data-testid="${testId}"]`).attributes('data-open')
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

const BACKFILL_URL = '/api/v1/memory/backfill'

function mockApi(options: {
  backfill?: Record<string, unknown> | Error
  history?: Record<string, unknown>
  extract?: Record<string, unknown> | Error
  reset?: Record<string, unknown> | Error
} = {}) {
  mocks.fetch.mockImplementation(async (url: string) => {
    const response = {
      [BACKFILL_URL]: options.backfill
        ?? useState('memory-backfill-overview').value
        ?? { job: null, estimate: null, reason: null },
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
    clearNuxtState('memory-backfill-overview')
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

  it('emits add when Add memory is clicked', async () => {
    const wrapper = await mountToolbar()
    const addButton = wrapper.get('[data-testid="memory-add"]')

    expect(addButton.text()).toContain('Add memory')

    await addButton.trigger('click')

    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('offers Add memory with generation off', async () => {
    const wrapper = await mountToolbar({
      settings: { ...defaultSettings, memoryExtractionEnabled: false },
    })

    expect(wrapper.find('[data-testid="memory-add"]').exists()).toBe(true)
  })

  describe('extra actions slot', () => {
    it('renders nothing when the slot is empty', async () => {
      const wrapper = await mountToolbar()

      expect(wrapper.find('.js-memory-extra-actions').exists()).toBe(false)
      expect(wrapper.find('[data-testid="memory-extra-actions"]').exists())
        .toBe(false)
    })

    it('wraps the provided buttons right after Add memory', async () => {
      const wrapper = await mountToolbar({}, {
        'extra-actions': () => h('button', {
          'type': 'button',
          'data-testid': 'future-action',
        }, 'Build memory from past chats'),
      })
      const extra = wrapper.get('.js-memory-extra-actions')
      const actions = [...extra.element.parentElement!.children]

      expect(extra.attributes('data-testid')).toBe('memory-extra-actions')
      expect(extra.classes()).toEqual(expect.arrayContaining([
        'flex',
        'flex-wrap',
        'items-center',
        'gap-2',
      ]))
      expect(extra.get('[data-testid="future-action"]').text())
        .toBe('Build memory from past chats')
      const extraIndex = actions.indexOf(extra.element)

      expect(actions[extraIndex - 1]!
        .querySelector('[data-testid="memory-add"]')).not.toBeNull()
    })
  })

  it('links the export to the download route', async () => {
    const wrapper = await mountToolbar()
    const link = wrapper.get('[data-testid="memory-export"]')

    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('/api/v1/memory/export')
    expect(link.attributes('download')).toBeDefined()
  })

  it('has no scope switch', async () => {
    const wrapper = await mountToolbar()

    expect(wrapper.find('[data-testid="memory-scope-select"]').exists())
      .toBe(false)
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

  it('explains where update now reads from in the account scope', async () => {
    const wrapper = await mountToolbar()

    expect(wrapper.get('[data-testid="memory-update-now-note"]').text())
      .toBe('Reads your latest account chat and runs on your own API key.')
  })

  describe('update memory now', () => {
    it('extracts the most recent chat and reports the counts', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      const calls = mocks.fetch.mock.calls.filter(([url]) => {
        return url !== BACKFILL_URL
      })

      expect(calls[0]).toEqual([
        '/api/v1/chats/history',
        { query: { limit: 100 } },
      ])
      expect(calls[1]).toEqual([
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

    it('skips project chats in the account scope', async () => {
      mockApi({
        history: {
          pinned: [{
            slug: 'pinned-project-chat',
            projectId: 'project-1',
            activityAt: '2026-04-01T00:00:00Z',
          }],
          chats: [
            {
              slug: 'newer-project-chat',
              projectId: 'project-1',
              activityAt: '2026-03-01T00:00:00Z',
            },
            {
              slug: 'account-chat',
              projectId: null,
              activityAt: '2026-02-01T00:00:00Z',
            },
          ],
          nextCursor: null,
        },
      })

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-update-now"]')
        .trigger('click')
      await flushPromises()

      expect(callsTo('/api/v1/memory/extract-now')[0]![1].body)
        .toEqual({ chatSlug: 'account-chat' })
    })

    it('says so when only project chats exist in the account scope',
      async () => {
        mockApi({
          history: {
            pinned: [],
            chats: [{
              slug: 'project-chat',
              projectId: 'project-1',
              activityAt: '2026-02-01T00:00:00Z',
            }],
            nextCursor: null,
          },
        })

        const wrapper = await mountToolbar()

        await wrapper.get('[data-testid="memory-update-now"]')
          .trigger('click')
        await flushPromises()

        expect(callsTo('/api/v1/memory/extract-now')).toHaveLength(0)
        expect(mocks.info).toHaveBeenCalledWith(
          'No chats to read yet',
          'Start a chat outside any project, then try again.',
        )
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
        'Start a chat outside any project, then try again.',
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
      ['skipped', 'no-user-text', 'No new messages to read since the last update.'],
      ['skipped', 'project-unavailable', 'This project is no longer available.'],
      ['skipped', 'chat-unavailable', 'Your latest chat is no longer available.'],
      ['leased', undefined, 'Besidka is already updating memory from this chat.'],
      ['skipped', 'something-new', 'Nothing was updated.'],
      ['skipped', undefined, 'Nothing was updated.'],
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
      expect(visibleLabel(wrapper, 'memory-update-now')).toBe('Updating...')
      expect(runningButton.find('.loading').exists()).toBe(true)

      finishHistory({
        pinned: [],
        chats: [{ slug: 'latest-chat', activityAt: '2026-02-01T00:00:00Z' }],
      })
      await flushPromises()

      const idleButton = wrapper.get('[data-testid="memory-update-now"]')

      expect(idleButton.classes()).not.toContain('btn-disabled')
      expect(visibleLabel(wrapper, 'memory-update-now'))
        .toBe('Update memory now')
    })
  })

  describe('reset memory', () => {
    it('names the account memory and keeps project memory in the confirmation', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-reset"]').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Reset your account memory?',
        subtitle: 'This deletes every account memory entry (Profile, '
          + 'Preferences, Topics, Areas, People). Project memory is kept. '
          + 'This cannot be undone.',
        alert: true,
        actions: ['Delete entries'],
        labelDecline: 'Cancel',
      })
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
  describe('action row', () => {
    it('keeps the primary actions first and the rest in a wrapping row',
      async () => {
        const wrapper = await mountToolbar()
        const addButton = wrapper.get('[data-testid="memory-add"]')
        const actionRow = addButton.element.parentElement!.parentElement!
        const secondary = wrapper.get('[data-testid="memory-backfill"]')
          .element.parentElement!

        expect(actionRow.className).toContain('flex-wrap')
        expect(actionRow.className).toContain('gap-2')
        expect(secondary.className).toBe('hidden sm:contents')
        expect([...secondary.children].map((child) => {
          return child.getAttribute('data-testid')
            ?? child.querySelector('[data-testid]')?.getAttribute('data-testid')
        })).toEqual([
          'memory-backfill',
          'memory-import',
          'memory-export',
          'memory-reset',
        ])
      })

    it('opens the build memory sheet from the row button', async () => {
      const wrapper = await mountToolbar()

      expect(sheetOpen(wrapper, 'stub-backfill-sheet')).toBe('false')

      await wrapper.get('[data-testid="memory-backfill"]').trigger('click')

      expect(sheetOpen(wrapper, 'stub-backfill-sheet')).toBe('true')
      expect(sheetOpen(wrapper, 'stub-import-sheet')).toBe('false')
    })

    it('opens the import sheet from the row button', async () => {
      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-import"]').trigger('click')

      expect(sheetOpen(wrapper, 'stub-import-sheet')).toBe('true')
      expect(sheetOpen(wrapper, 'stub-backfill-sheet')).toBe('false')
    })

    it.each([
      ['stub-backfill-sheet'],
      ['stub-import-sheet'],
    ])('re-emits changed from %s', async (testId) => {
      const wrapper = await mountToolbar()

      wrapper.getComponent(
        testId === 'stub-backfill-sheet' ? BackfillSheetStub : ImportSheetStub,
      ).vm.$emit('changed')

      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('labels the build button with the idle copy by default', async () => {
      const wrapper = await mountToolbar()
      const button = wrapper.get('[data-testid="memory-backfill"]')

      expect(visibleLabel(wrapper, 'memory-backfill'))
        .toBe('Build memory from past chats')
      expect(button.attributes('title')).toBeUndefined()
      expect(button.classes()).not.toContain('opacity-60')
      expect(button.find('.loading').exists()).toBe(false)
    })

    it('stays clickable but looks secondary when generation is off',
      async () => {
        const wrapper = await mountToolbar({
          settings: { ...defaultSettings, memoryExtractionEnabled: false },
        })
        const button = wrapper.get('[data-testid="memory-backfill"]')

        expect(button.element.tagName).toBe('BUTTON')
        expect(button.attributes('disabled')).toBeUndefined()
        expect(button.classes()).toContain('opacity-60')
        expect(button.attributes('title'))
          .toBe('Turn on Generate memory from chats first.')

        await button.trigger('click')

        expect(sheetOpen(wrapper, 'stub-backfill-sheet')).toBe('true')
      })

    it('explains that memory itself is off', async () => {
      const wrapper = await mountToolbar({
        settings: { ...defaultSettings, memoryEnabled: false },
      })

      expect(wrapper.get('[data-testid="memory-backfill"]')
        .attributes('title')).toBe('Turn on Use memory first.')
    })

    it('shows the live progress while a job is running', async () => {
      useState('memory-backfill-overview').value = {
        job: {
          id: 'job-1',
          status: 'running',
          processedChats: 12,
          totalChats: 48,
        },
        estimate: null,
        reason: null,
      }

      const wrapper = await mountToolbar()
      const button = wrapper.get('[data-testid="memory-backfill"]')

      expect(visibleLabel(wrapper, 'memory-backfill')).toBe('Building… 12/48')
      expect(button.find('.loading').exists()).toBe(true)
      expect(wrapper.get('[data-testid="memory-backfill-menu"]').text())
        .toBe('Building… 12/48')
    })

    it('loads the backfill overview once on mount, before any sheet opens',
      async () => {
        await mountToolbar()
        await flushPromises()

        expect(callsTo(BACKFILL_URL)).toHaveLength(1)
      })

    it('shows a running job found by the mount load after a reload',
      async () => {
        mockApi({
          backfill: {
            job: {
              id: 'job-1',
              status: 'running',
              processedChats: 12,
              totalChats: 48,
            },
            estimate: null,
            reason: null,
          },
        })

        const wrapper = await mountToolbar()

        await flushPromises()

        expect(visibleLabel(wrapper, 'memory-backfill'))
          .toBe('Building… 12/48')
        expect(wrapper.get('[data-testid="memory-backfill-menu"]').text())
          .toBe('Building… 12/48')
      })

    it('refreshes the progress in the background while a job runs',
      async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

        try {
          mockApi({
            backfill: {
              job: { id: 'job-1', status: 'running' },
              estimate: null,
              reason: null,
            },
          })

          await mountToolbar()
          await flushPromises()
          await vi.advanceTimersByTimeAsync(20_000)

          expect(callsTo(BACKFILL_URL).length).toBeGreaterThanOrEqual(2)
        } finally {
          vi.useRealTimers()
        }
      })

    it('stays silent when the mount load fails', async () => {
      mockApi({ backfill: createRejection(500, 'Boom', 'Database down') })

      const wrapper = await mountToolbar()

      await flushPromises()

      expect(mocks.error).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(visibleLabel(wrapper, 'memory-backfill'))
        .toBe('Build memory from past chats')
    })

    it('refreshes the list when a job finishes with the sheet closed',
      async () => {
        const overview = useState<Record<string, unknown> | null>(
          'memory-backfill-overview',
        )

        overview.value = {
          job: { id: 'job-1', status: 'running' },
          estimate: null,
          reason: null,
        }

        const wrapper = await mountToolbar()

        overview.value = {
          job: { id: 'job-1', status: 'completed' },
          estimate: null,
          reason: null,
        }
        await flushPromises()

        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('leaves the refresh to the sheet while it is open', async () => {
      const overview = useState<Record<string, unknown> | null>(
        'memory-backfill-overview',
      )

      overview.value = {
        job: { id: 'job-1', status: 'running' },
        estimate: null,
        reason: null,
      }

      const wrapper = await mountToolbar()

      await wrapper.get('[data-testid="memory-backfill"]').trigger('click')

      overview.value = {
        job: { id: 'job-1', status: 'completed' },
        estimate: null,
        reason: null,
      }
      await flushPromises()

      expect(wrapper.emitted('changed')).toBeUndefined()
    })
  })

  describe('more menu on small screens', () => {
    function menuOf(wrapper: Wrapper) {
      return wrapper.get('[data-testid="memory-more"]')
    }

    async function toggleMenu(wrapper: Wrapper, isOpen: boolean) {
      const details = menuOf(wrapper).element as HTMLDetailsElement

      details.open = isOpen
      details.dispatchEvent(new Event('toggle'))
      await flushPromises()
    }

    it('renders a small-screen only dropdown next to the row', async () => {
      const wrapper = await mountToolbar()
      const menu = menuOf(wrapper)
      const trigger = wrapper.get('[data-testid="memory-more-trigger"]')

      expect(menu.element.tagName).toBe('DETAILS')
      expect(menu.classes()).toEqual(expect.arrayContaining([
        'dropdown',
        'sm:hidden',
      ]))
      expect(trigger.text()).toBe('More')
      expect(trigger.attributes('aria-haspopup')).toBeUndefined()
      expect(trigger.attributes('role')).toBeUndefined()
      expect(trigger.attributes('aria-expanded')).toBe('false')
      expect(menu.get('ul').classes()).toContain('rounded-box')
    })

    it('is a plain disclosure of buttons without menu roles', async () => {
      const wrapper = await mountToolbar()
      const menu = menuOf(wrapper)

      expect(menu.find('[role]').exists()).toBe(false)
      expect(menu.find('[aria-haspopup]').exists()).toBe(false)
      expect(menu.find('[data-testid="memory-backfill-menu"]').element
        .tagName).toBe('BUTTON')
      expect(menu.find('[data-testid="memory-import-menu"]').element
        .tagName).toBe('BUTTON')
      expect(menu.find('[data-testid="memory-reset-menu"]').element
        .tagName).toBe('BUTTON')
      expect(menu.find('[data-testid="memory-export-menu"]').element
        .tagName).toBe('A')
    })

    it('duplicates the secondary actions with unique test ids', async () => {
      const wrapper = await mountToolbar()

      for (const testId of [
        'memory-backfill-menu',
        'memory-import-menu',
        'memory-export-menu',
        'memory-reset-menu',
      ]) {
        const items = wrapper.findAll(`[data-testid="${testId}"]`)

        expect(items).toHaveLength(1)
      }

      expect(wrapper.get('[data-testid="memory-export-menu"]')
        .attributes('href')).toBe('/api/v1/memory/export')
    })

    it('keeps the primary actions out of the menu', async () => {
      const wrapper = await mountToolbar()
      const menu = menuOf(wrapper)

      expect(menu.find('[data-testid="memory-add"]').exists()).toBe(false)
      expect(menu.find('[data-testid="memory-update-now"]').exists())
        .toBe(false)
    })

    it('reflects the open state in aria-expanded', async () => {
      const wrapper = await mountToolbar()

      await toggleMenu(wrapper, true)

      expect(wrapper.get('[data-testid="memory-more-trigger"]')
        .attributes('aria-expanded')).toBe('true')

      await toggleMenu(wrapper, false)

      expect(wrapper.get('[data-testid="memory-more-trigger"]')
        .attributes('aria-expanded')).toBe('false')
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      const wrapper = await mountToolbar()
      const details = menuOf(wrapper).element as HTMLDetailsElement

      const trigger = wrapper.get('[data-testid="memory-more-trigger"]')
      const focusSpy = vi.spyOn(trigger.element as HTMLElement, 'focus')

      await toggleMenu(wrapper, true)
      await menuOf(wrapper).trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(details.open).toBe(false)
      expect(trigger.attributes('aria-expanded')).toBe('false')
      expect(focusSpy).toHaveBeenCalledTimes(1)
    })

    it('returns focus to the trigger after choosing an item', async () => {
      const wrapper = await mountToolbar()
      const trigger = wrapper.get('[data-testid="memory-more-trigger"]')
      const focusSpy = vi.spyOn(trigger.element as HTMLElement, 'focus')

      for (const testId of [
        'memory-backfill-menu',
        'memory-import-menu',
        'memory-export-menu',
      ]) {
        focusSpy.mockClear()

        await toggleMenu(wrapper, true)
        await wrapper.get(`[data-testid="${testId}"]`).trigger('click')

        expect(focusSpy).toHaveBeenCalledTimes(1)
      }
    })

    it('does not move focus when the menu closes from an outside click',
      async () => {
        const wrapper = await mountToolbar()
        const trigger = wrapper.get('[data-testid="memory-more-trigger"]')
        const focusSpy = vi.spyOn(trigger.element as HTMLElement, 'focus')

        await toggleMenu(wrapper, true)
        await toggleMenu(wrapper, false)

        expect(focusSpy).not.toHaveBeenCalled()
      })

    it('opens the build sheet and closes the menu', async () => {
      const wrapper = await mountToolbar()
      const details = menuOf(wrapper).element as HTMLDetailsElement

      await toggleMenu(wrapper, true)
      await wrapper.get('[data-testid="memory-backfill-menu"]')
        .trigger('click')

      expect(details.open).toBe(false)
      expect(sheetOpen(wrapper, 'stub-backfill-sheet')).toBe('true')
    })

    it('opens the import sheet and closes the menu', async () => {
      const wrapper = await mountToolbar()
      const details = menuOf(wrapper).element as HTMLDetailsElement

      await toggleMenu(wrapper, true)
      await wrapper.get('[data-testid="memory-import-menu"]')
        .trigger('click')

      expect(details.open).toBe(false)
      expect(sheetOpen(wrapper, 'stub-import-sheet')).toBe('true')
    })

    it('closes the menu when export is chosen', async () => {
      const wrapper = await mountToolbar()
      const details = menuOf(wrapper).element as HTMLDetailsElement

      await toggleMenu(wrapper, true)
      await wrapper.get('[data-testid="memory-export-menu"]')
        .trigger('click')

      expect(details.open).toBe(false)
    })

    it('resets memory from the menu with the same confirmation',
      async () => {
        const wrapper = await mountToolbar()
        const details = menuOf(wrapper).element as HTMLDetailsElement

        await toggleMenu(wrapper, true)
        await wrapper.get('[data-testid="memory-reset-menu"]')
          .trigger('click')
        await flushPromises()

        expect(details.open).toBe(false)
        expect(mocks.confirm).toHaveBeenCalledTimes(1)
        expect(callsTo('/api/v1/memory/entries/reset')).toHaveLength(1)
        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('disables the menu reset when there are no entries', async () => {
      const wrapper = await mountToolbar({ total: 0 })
      const item = wrapper.get('[data-testid="memory-reset-menu"]')

      expect(item.attributes('disabled')).toBeDefined()

      await item.trigger('click')
      await flushPromises()

      expect(mocks.confirm).not.toHaveBeenCalled()
    })

    it('starts every action row at the left edge, under the count',
      async () => {
        const wrapper = await mountToolbar()
        const rows = wrapper.get('[data-testid="memory-toolbar-rows"]')
        const actions = wrapper.get('[data-testid="memory-toolbar-actions"]')
        const layoutClasses = [...rows.classes(), ...actions.classes()]

        expect(layoutClasses.some((className) => {
          return className.includes('justify-end')
            || className.includes('justify-between')
        })).toBe(false)
        expect(rows.classes()).toEqual(expect.arrayContaining([
          'flex-col',
          'items-start',
        ]))
        expect(actions.classes()).toContain('justify-start')
        expect(rows.element.firstElementChild?.querySelector(
          '[data-testid="memory-entries-count"]',
        )).not.toBeNull()
      })

    it.each([
      {
        button: 'memory-update-now',
        idle: 'Update memory now',
        busy: 'Updating...',
      },
      {
        button: 'memory-backfill',
        idle: 'Build memory from past chats',
        busy: 'Building…',
      },
    ])('stacks both $button labels in one grid cell so the width never '
      + 'changes', async ({ button, idle, busy }) => {
      const wrapper = await mountToolbar()
      const cell = wrapper.get(`[data-testid="${button}-labels"]`)
      const idleLabel = wrapper.get(`[data-testid="${button}-idle-label"]`)
      const busyLabel = wrapper.get(`[data-testid="${button}-busy-label"]`)

      expect(cell.classes()).toContain('grid')
      expect(idleLabel.element.parentElement).toBe(cell.element)
      expect(busyLabel.element.parentElement).toBe(cell.element)

      for (const label of [idleLabel, busyLabel]) {
        expect(label.classes()).toEqual(expect.arrayContaining([
          'col-start-1',
          'row-start-1',
        ]))
      }

      expect(idleLabel.text()).toBe(idle)
      expect(busyLabel.text()).toBe(busy)
      expect(idleLabel.classes()).not.toContain('invisible')
      expect(busyLabel.classes()).toContain('invisible')
      expect(busyLabel.attributes('aria-hidden')).toBe('true')
    })

    it('hides the row group and the menu with matching breakpoints',
      async () => {
        const wrapper = await mountToolbar()
        const group = wrapper.get('[data-testid="memory-backfill"]')
          .element.parentElement!

        expect(group.classList.contains('hidden')).toBe(true)
        expect(group.classList.contains('sm:contents')).toBe(true)
        expect(menuOf(wrapper).classes()).toContain('sm:hidden')
      })
  })
})
