import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  googleToolPermissionPutQueue,
  useGoogleToolPermissions,
} from '../../../app/composables/google-tool-permissions'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}))

interface Row {
  name: string
  service: 'drive' | 'gmail' | 'calendar'
  mode: 'blocked' | 'ask'
}

const data = ref<{ tools: Row[] } | null>(null)
const status = ref<string>('success')
const fetchError = ref<unknown>(null)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data,
    status,
    error: fetchError,
    refresh: mocks.refresh,
  })
})

const SEARCH = 'google__gmail_search'
const READ_THREAD = 'google__gmail_read_thread'
const LIST_EVENTS = 'google__calendar_list_events'

function seed() {
  data.value = {
    tools: [
      { name: SEARCH, service: 'gmail', mode: 'ask' },
      { name: READ_THREAD, service: 'gmail', mode: 'ask' },
      { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })

  return { promise, resolve, reject }
}

function modesOf(tools: Array<{ name: string, mode: string }>) {
  return Object.fromEntries(tools.map(tool => [tool.name, tool.mode]))
}

describe('useGoogleToolPermissions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    mocks.refresh.mockReset()
    googleToolPermissionPutQueue.reset()
    status.value = 'success'
    fetchError.value = null
    seed()
  })

  it('lists the stored modes', () => {
    const { tools } = useGoogleToolPermissions()

    expect(modesOf(tools.value)).toEqual({
      [SEARCH]: 'ask',
      [READ_THREAD]: 'ask',
      [LIST_EVENTS]: 'ask',
    })
  })

  it('shows a change at once and keeps the server list on success',
    async () => {
      const pending = deferred<{ tools: Row[] }>()

      mocks.fetch.mockReturnValueOnce(pending.promise)

      const { tools, save, isSaving } = useGoogleToolPermissions()
      const saving = save({ tool: SEARCH }, 'blocked')

      expect(modesOf(tools.value)[SEARCH]).toBe('blocked')
      expect(modesOf(tools.value)[READ_THREAD]).toBe('ask')
      expect(isSaving.value).toBe(true)

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/tool-permissions',
        { method: 'PUT', body: { tool: SEARCH, mode: 'blocked' } },
      )

      pending.resolve({
        tools: [
          { name: SEARCH, service: 'gmail', mode: 'blocked' },
          { name: READ_THREAD, service: 'gmail', mode: 'ask' },
          { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
        ],
      })
      await saving

      expect(modesOf(tools.value)[SEARCH]).toBe('blocked')
      expect(isSaving.value).toBe(false)
      expect(mocks.error).not.toHaveBeenCalled()
    })

  it('rolls the optimistic mode back and reports the error on a failure',
    async () => {
      mocks.fetch.mockRejectedValueOnce(Object.assign(new Error('Nope'), {
        data: { message: 'Not found', why: 'Not available for this account' },
      }))

      const { tools, save, announcement } = useGoogleToolPermissions()

      await save({ tool: SEARCH }, 'blocked')

      expect(modesOf(tools.value)[SEARCH]).toBe('ask')
      expect(mocks.error).toHaveBeenCalledTimes(1)
      expect(announcement.value).toBe('')
    })

  it('sets every tool of a service optimistically and sends the service',
    async () => {
      const pending = deferred<{ tools: Row[] }>()

      mocks.fetch.mockReturnValueOnce(pending.promise)

      const { tools, save } = useGoogleToolPermissions()
      const saving = save({ service: 'gmail' }, 'blocked')

      expect(modesOf(tools.value)).toEqual({
        [SEARCH]: 'blocked',
        [READ_THREAD]: 'blocked',
        [LIST_EVENTS]: 'ask',
      })

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/tool-permissions',
        { method: 'PUT', body: { service: 'gmail', mode: 'blocked' } },
      )

      pending.reject(new Error('Nope'))
      await saving

      expect(modesOf(tools.value)[SEARCH]).toBe('ask')
      expect(modesOf(tools.value)[READ_THREAD]).toBe('ask')
    })

  it('announces a saved change with the tool title and the mode label',
    async () => {
      mocks.fetch.mockResolvedValueOnce({
        tools: [{ name: SEARCH, service: 'gmail', mode: 'blocked' }],
      })

      const { save, announcement } = useGoogleToolPermissions()

      await save({ tool: SEARCH }, 'blocked')

      expect(announcement.value).toBe('Search your Gmail: Blocked.')

      mocks.fetch.mockResolvedValueOnce({
        tools: [{ name: SEARCH, service: 'gmail', mode: 'ask' }],
      })
      await save({ tool: SEARCH }, 'ask')

      expect(announcement.value).toBe('Search your Gmail: Needs approval.')
    })

  it('keeps a second pending change when the first one settles', async () => {
    const first = deferred<{ tools: Row[] }>()
    const second = deferred<{ tools: Row[] }>()

    mocks.fetch.mockReturnValueOnce(first.promise)
    mocks.fetch.mockReturnValueOnce(second.promise)

    const { tools, save } = useGoogleToolPermissions()
    const savingFirst = save({ tool: SEARCH }, 'blocked')
    const savingSecond = save({ tool: READ_THREAD }, 'blocked')

    first.reject(new Error('Nope'))
    await savingFirst

    expect(modesOf(tools.value)[SEARCH]).toBe('ask')
    expect(modesOf(tools.value)[READ_THREAD]).toBe('blocked')

    second.reject(new Error('Nope'))
    await savingSecond
  })

  it('leaves the last click on screen when two saves of one tool settle '
    + 'in reverse order', async () => {
    const first = deferred<{ tools: Row[] }>()
    const second = deferred<{ tools: Row[] }>()

    mocks.fetch.mockReturnValueOnce(first.promise)
    mocks.fetch.mockReturnValueOnce(second.promise)

    const { tools, save, announcement } = useGoogleToolPermissions()
    const savingFirst = save({ tool: SEARCH }, 'blocked')
    const savingSecond = save({ service: 'gmail' }, 'ask')

    expect(modesOf(tools.value)[SEARCH]).toBe('ask')

    second.resolve({
      tools: [
        { name: SEARCH, service: 'gmail', mode: 'ask' },
        { name: READ_THREAD, service: 'gmail', mode: 'ask' },
        { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
      ],
    })
    await savingSecond

    first.resolve({
      tools: [
        { name: SEARCH, service: 'gmail', mode: 'blocked' },
        { name: READ_THREAD, service: 'gmail', mode: 'ask' },
        { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
      ],
    })
    await savingFirst

    expect(modesOf(tools.value)[SEARCH]).toBe('ask')
    expect(announcement.value).toBe('Gmail tools: Needs approval.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('ignores an older response that arrives while the newer save is '
    + 'still pending', async () => {
    const first = deferred<{ tools: Row[] }>()
    const second = deferred<{ tools: Row[] }>()

    mocks.fetch.mockReturnValueOnce(first.promise)
    mocks.fetch.mockReturnValueOnce(second.promise)

    const { tools, save } = useGoogleToolPermissions()
    const savingFirst = save({ tool: SEARCH }, 'blocked')
    const savingSecond = save({ service: 'gmail' }, 'ask')

    first.resolve({
      tools: [
        { name: SEARCH, service: 'gmail', mode: 'blocked' },
        { name: READ_THREAD, service: 'gmail', mode: 'ask' },
        { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
      ],
    })
    await savingFirst

    expect(modesOf(tools.value)[SEARCH]).toBe('ask')

    second.resolve({
      tools: [
        { name: SEARCH, service: 'gmail', mode: 'ask' },
        { name: READ_THREAD, service: 'gmail', mode: 'ask' },
        { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
      ],
    })
    await savingSecond

    expect(modesOf(tools.value)[SEARCH]).toBe('ask')
  })

  it('refetches once nothing is pending after the newest save fails',
    async () => {
      const first = deferred<{ tools: Row[] }>()
      const second = deferred<{ tools: Row[] }>()

      mocks.fetch.mockReturnValueOnce(first.promise)
      mocks.fetch.mockReturnValueOnce(second.promise)

      const { tools, save } = useGoogleToolPermissions()
      const savingFirst = save({ tool: SEARCH }, 'blocked')
      const savingSecond = save({ service: 'gmail' }, 'ask')

      first.resolve({
        tools: [
          { name: SEARCH, service: 'gmail', mode: 'blocked' },
          { name: READ_THREAD, service: 'gmail', mode: 'ask' },
          { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
        ],
      })
      await savingFirst

      expect(mocks.refresh).not.toHaveBeenCalled()

      second.reject(new Error('Nope'))
      await savingSecond

      expect(mocks.refresh).toHaveBeenCalledTimes(1)
      expect(modesOf(tools.value)[SEARCH]).toBe('ask')
    })

  it('sets the read tools of a service in one request and announces once',
    async () => {
      data.value = {
        tools: [
          { name: SEARCH, service: 'gmail', mode: 'ask' },
          { name: READ_THREAD, service: 'gmail', mode: 'ask' },
          { name: 'google__gmail_create_draft', service: 'gmail', mode: 'ask' },
          { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
        ],
      }

      const pending = deferred<{ tools: Row[] }>()

      mocks.fetch.mockReturnValueOnce(pending.promise)

      const { tools, save, announcement } = useGoogleToolPermissions()
      const saving = save({ service: 'gmail', kind: 'read' }, 'blocked')

      expect(modesOf(tools.value)).toEqual({
        [SEARCH]: 'blocked',
        [READ_THREAD]: 'blocked',
        google__gmail_create_draft: 'ask',
        [LIST_EVENTS]: 'ask',
      })

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/google/tool-permissions',
        {
          method: 'PUT',
          body: { service: 'gmail', kind: 'read', mode: 'blocked' },
        },
      )

      pending.resolve({
        tools: [
          { name: SEARCH, service: 'gmail', mode: 'blocked' },
          { name: READ_THREAD, service: 'gmail', mode: 'blocked' },
          { name: 'google__gmail_create_draft', service: 'gmail', mode: 'ask' },
          { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
        ],
      })
      await saving

      expect(announcement.value).toBe('Gmail read tools: Blocked.')
    })

  it('rolls every tool of a failed group back together', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Nope'))

    const { tools, save, announcement } = useGoogleToolPermissions()

    await save({ service: 'gmail', kind: 'read' }, 'blocked')

    expect(modesOf(tools.value)).toEqual({
      [SEARCH]: 'ask',
      [READ_THREAD]: 'ask',
      [LIST_EVENTS]: 'ask',
    })
    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(announcement.value).toBe('')
  })

  describe('spacing saves of one target', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('queues a second save of the same tool until 1.1 s after the '
      + 'first, and never drops it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      mocks.fetch.mockImplementation(async (
        _url: string,
        init: { body: { mode: string } },
      ) => ({
        tools: [
          { name: SEARCH, service: 'gmail', mode: init.body.mode },
          { name: READ_THREAD, service: 'gmail', mode: 'ask' },
          { name: LIST_EVENTS, service: 'calendar', mode: 'ask' },
        ],
      }))

      const { tools, save } = useGoogleToolPermissions()

      await save({ tool: SEARCH }, 'blocked')

      const second = save({ tool: SEARCH }, 'ask')

      await vi.advanceTimersByTimeAsync(1099)

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(modesOf(tools.value)[SEARCH]).toBe('ask')

      await vi.advanceTimersByTimeAsync(1)
      await second

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(modesOf(tools.value)[SEARCH]).toBe('ask')
    })

    it('sends saves of different targets without waiting', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      mocks.fetch.mockImplementation(async () => ({ tools: data.value!.tools }))

      const { save } = useGoogleToolPermissions()

      await save({ tool: SEARCH }, 'blocked')
      await save({ tool: READ_THREAD }, 'blocked')
      await save({ service: 'calendar' }, 'blocked')

      expect(mocks.fetch).toHaveBeenCalledTimes(3)
    })
  })

  it('reads a 404 as the account reaching no Google tool', () => {
    fetchError.value = Object.assign(new Error('Not found'), {
      statusCode: 404,
    })

    expect(useGoogleToolPermissions().isUnavailable.value).toBe(true)

    fetchError.value = Object.assign(new Error('Failed'), { statusCode: 500 })

    expect(useGoogleToolPermissions().isUnavailable.value).toBe(false)
  })
})
