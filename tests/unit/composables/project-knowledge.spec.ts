import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeItem,
  ProjectKnowledgeSummary,
} from '../../../shared/types/project-knowledge.d'
import { useProjectKnowledge } from '../../../app/composables/project-knowledge'

interface VersionResult {
  version: number
  packVersion: number
}

interface Deferred<Value> {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (reason: unknown) => void
}

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  fetchMock: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('$fetch', () => mocks.fetchMock)

const summaryData = shallowRef<ProjectKnowledgeSummary | undefined>(undefined)
const summaryPending = shallowRef<boolean>(false)
const summaryError = shallowRef<unknown>(undefined)
const refreshSummary = vi.fn()

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

async function flushAsync(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve()
  }
}

function createItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item-1',
    projectId: 'project-1',
    kind: 'file',
    fileId: null,
    title: 'notes.md',
    description: null,
    relativePath: null,
    folderId: null,
    mediaType: 'text/markdown',
    sizeBytes: 100,
    pageCount: null,
    textBytes: 100,
    latinChars: 90,
    cyrillicChars: 5,
    otherChars: 5,
    extractStatus: 'ready',
    extractError: null,
    extractor: 'text',
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  }
}

function createSummary(
  overrides: Partial<ProjectKnowledgeSummary> = {},
): ProjectKnowledgeSummary {
  const items = overrides.items ?? [createItem()]

  return {
    projectId: 'project-1',
    mode: 'auto',
    version: 3,
    packVersion: 3,
    items,
    totals: {
      latinChars: items.reduce((sum, item) => sum + item.latinChars, 0),
      cyrillicChars: items.reduce((sum, item) => sum + item.cyrillicChars, 0),
      otherChars: items.reduce((sum, item) => sum + item.otherChars, 0),
      textBytes: items.reduce((sum, item) => sum + item.textBytes, 0),
      items: items.length,
    },
    ...overrides,
  }
}

function createQuotaFetchError(): Record<string, unknown> {
  return {
    message: 'fetch failed',
    data: {
      message: 'Not enough storage space',
      status: 413,
      data: { why: 'The project quota is full' },
    },
  }
}

describe('useProjectKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchMock.mockReset()
    refreshSummary.mockReset()
    refreshSummary.mockResolvedValue(undefined)
    summaryData.value = createSummary()
    summaryPending.value = false
    summaryError.value = undefined
    mocks.useLazyFetch.mockImplementation(() => {
      return {
        data: summaryData,
        pending: summaryPending,
        error: summaryError,
        refresh: refreshSummary,
      }
    })
  })

  describe('summary fetch', () => {
    it('requests the project summary with a project-scoped key', () => {
      const projectId = shallowRef<string | undefined>('project-1')

      useProjectKnowledge(projectId)

      const [urlGetter, options] = mocks.useLazyFetch.mock.calls[0] ?? []

      expect(urlGetter()).toBe('/api/v1/projects/project-1/knowledge')
      expect(options.key()).toBe('project-knowledge:project-1')
      expect(options.enabled()).toBe(true)

      projectId.value = 'project-2'

      expect(urlGetter()).toBe('/api/v1/projects/project-2/knowledge')
      expect(options.key()).toBe('project-knowledge:project-2')
    })

    it('does not fetch while the project id is missing', () => {
      const projectId = shallowRef<string | undefined>(undefined)

      useProjectKnowledge(projectId)

      const options = mocks.useLazyFetch.mock.calls[0]?.[1]

      expect(options.enabled()).toBe(false)
      expect(options.key()).toBe('project-knowledge:none')

      projectId.value = 'project-1'

      expect(options.enabled()).toBe(true)
    })

    it('accepts a plain string and a getter', () => {
      useProjectKnowledge('project-1')
      useProjectKnowledge(() => 'project-9')

      const [firstUrl] = mocks.useLazyFetch.mock.calls[0] ?? []
      const [secondUrl] = mocks.useLazyFetch.mock.calls[1] ?? []

      expect(firstUrl()).toBe('/api/v1/projects/project-1/knowledge')
      expect(secondUrl()).toBe('/api/v1/projects/project-9/knowledge')
    })

    it('derives items, totals, version and defaults from the summary', () => {
      const knowledge = useProjectKnowledge('project-1')

      expect(knowledge.items.value).toHaveLength(1)
      expect(knowledge.totals.value.textBytes).toBe(100)
      expect(knowledge.version.value).toBe(3)
      expect(knowledge.packVersion.value).toBe(3)
      expect(knowledge.mode.value).toBe('auto')

      summaryData.value = undefined

      expect(knowledge.items.value).toEqual([])
      expect(knowledge.totals.value.items).toBe(0)
      expect(knowledge.version.value).toBeNull()
      expect(knowledge.mode.value).toBe('auto')
    })

    it('exposes pending and error from the fetch', () => {
      const knowledge = useProjectKnowledge('project-1')

      summaryPending.value = true
      summaryError.value = new Error('boom')

      expect(knowledge.pending.value).toBe(true)
      expect(knowledge.error.value).toBeInstanceOf(Error)
    })
  })

  describe('mutations without a project', () => {
    it('returns a failed outcome and never calls the network', async () => {
      const knowledge = useProjectKnowledge(() => undefined)

      const outcome = await knowledge.removeItem('item-1')

      expect(outcome.ok).toBe(false)
      expect(mocks.fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('setMode', () => {
    it('applies the mode optimistically and confirms it', async () => {
      const deferred = createDeferred<{ mode: 'search' }>()

      mocks.fetchMock.mockReturnValueOnce(deferred.promise)

      const knowledge = useProjectKnowledge('project-mode-1')
      const pendingOutcome = knowledge.setMode('search')

      expect(knowledge.mode.value).toBe('search')
      expect(summaryData.value?.mode).toBe('auto')

      deferred.resolve({ mode: 'search' })

      const outcome = await pendingOutcome

      expect(outcome).toEqual({ ok: true, result: { mode: 'search' } })
      expect(knowledge.mode.value).toBe('search')
      expect(summaryData.value?.mode).toBe('search')
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-mode-1/knowledge/mode',
        { method: 'PATCH', body: { mode: 'search' } },
      )
    })

    it('rolls back to the previous mode when the request fails', async () => {
      mocks.fetchMock.mockRejectedValueOnce(createQuotaFetchError())

      const knowledge = useProjectKnowledge('project-mode-2')
      const pendingOutcome = knowledge.setMode('full')

      expect(knowledge.mode.value).toBe('full')

      const outcome = await pendingOutcome

      expect(outcome.ok).toBe(false)
      expect(knowledge.mode.value).toBe('auto')
      expect(summaryData.value?.mode).toBe('auto')
    })

    it('treats a null mode as the automatic default', async () => {
      summaryData.value = createSummary({ mode: 'search' })
      mocks.fetchMock.mockResolvedValueOnce({ mode: null })

      const knowledge = useProjectKnowledge('project-mode-3')
      const pendingOutcome = knowledge.setMode(null)

      expect(knowledge.mode.value).toBe('auto')

      await pendingOutcome

      expect(knowledge.mode.value).toBe('auto')
      expect(summaryData.value?.mode).toBe('auto')
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-mode-3/knowledge/mode',
        { method: 'PATCH', body: { mode: null } },
      )
    })

    it('keeps a newer optimistic mode when an older request fails', async () => {
      const first = createDeferred<{ mode: 'full' }>()
      const second = createDeferred<{ mode: 'search' }>()

      mocks.fetchMock
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      const knowledge = useProjectKnowledge('project-mode-4')
      const firstOutcome = knowledge.setMode('full')
      const secondOutcome = knowledge.setMode('search')

      first.reject(createQuotaFetchError())

      expect((await firstOutcome).ok).toBe(false)
      expect(knowledge.mode.value).toBe('search')

      await flushAsync()
      second.resolve({ mode: 'search' })

      expect((await secondOutcome).ok).toBe(true)
      expect(knowledge.mode.value).toBe('search')
      expect(summaryData.value?.mode).toBe('search')
    })

    it('refreshes when the summary is not loaded yet', async () => {
      summaryData.value = undefined
      mocks.fetchMock.mockResolvedValueOnce({ mode: 'full' })

      const knowledge = useProjectKnowledge('project-mode-5')

      await knowledge.setMode('full')

      expect(refreshSummary).toHaveBeenCalled()
    })

    it('drops the optimistic mode after a project switch', async () => {
      const projectId = shallowRef<string | undefined>('project-mode-6')
      const deferred = createDeferred<{ mode: 'full' }>()

      mocks.fetchMock.mockReturnValueOnce(deferred.promise)

      const knowledge = useProjectKnowledge(projectId)
      const pendingOutcome = knowledge.setMode('full')

      projectId.value = 'project-mode-7'
      summaryData.value = createSummary({
        projectId: 'project-mode-7',
        mode: 'search',
      })

      expect(knowledge.mode.value).toBe('search')

      deferred.resolve({ mode: 'full' })
      await pendingOutcome

      expect(summaryData.value?.mode).toBe('search')
    })
  })

  describe('serialised mutations', () => {
    it('runs one request at a time in call order', async () => {
      const first = createDeferred<VersionResult>()
      const second = createDeferred<VersionResult>()

      mocks.fetchMock
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      const knowledge = useProjectKnowledge('project-serial-1')
      const firstOutcome = knowledge.removeItem('item-1')
      const secondOutcome = knowledge.commit({ remove: ['item-2'] })

      await flushAsync()

      expect(mocks.fetchMock).toHaveBeenCalledTimes(1)

      first.resolve({ version: 4, packVersion: 4 })
      await firstOutcome
      await flushAsync()

      expect(mocks.fetchMock).toHaveBeenCalledTimes(2)
      expect(mocks.fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/v1/projects/project-serial-1/knowledge/commit',
      )

      second.resolve({ version: 5, packVersion: 5 })

      expect((await secondOutcome).ok).toBe(true)
    })

    it('keeps the chain alive after a failed mutation', async () => {
      mocks.fetchMock
        .mockRejectedValueOnce(createQuotaFetchError())
        .mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge('project-serial-2')
      const failedOutcome = knowledge.removeItem('item-1')
      const nextOutcome = knowledge.removeItem('item-1')

      expect((await failedOutcome).ok).toBe(false)
      expect((await nextOutcome).ok).toBe(true)
    })

    it('shares the chain between instances of the same project', async () => {
      const first = createDeferred<VersionResult>()

      mocks.fetchMock
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ version: 5, packVersion: 5 })

      const firstInstance = useProjectKnowledge('project-serial-3')
      const secondInstance = useProjectKnowledge('project-serial-3')
      const firstOutcome = firstInstance.removeItem('item-1')
      const secondOutcome = secondInstance.removeItem('item-2')

      await flushAsync()

      expect(mocks.fetchMock).toHaveBeenCalledTimes(1)

      first.resolve({ version: 4, packVersion: 4 })
      await firstOutcome
      await secondOutcome

      expect(mocks.fetchMock).toHaveBeenCalledTimes(2)
    })

    it('refresh waits for pending mutations before fetching', async () => {
      const deferred = createDeferred<VersionResult>()

      mocks.fetchMock.mockReturnValueOnce(deferred.promise)

      const knowledge = useProjectKnowledge('project-serial-4')
      const mutation = knowledge.removeItem('item-1')
      const refreshing = knowledge.refresh()

      await flushAsync()

      expect(refreshSummary).not.toHaveBeenCalled()

      deferred.resolve({ version: 4, packVersion: 4 })
      await mutation
      await refreshing

      expect(refreshSummary).toHaveBeenCalledTimes(1)
    })

    it('refetches once when a mutation starts during a refresh', async () => {
      const deferredRefresh = createDeferred<void>()

      refreshSummary
        .mockReturnValueOnce(deferredRefresh.promise)
        .mockResolvedValue(undefined)
      mocks.fetchMock.mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge('project-serial-5')
      const refreshing = knowledge.refresh()

      await flushAsync()
      await knowledge.removeItem('item-1')

      deferredRefresh.resolve()
      await refreshing

      expect(refreshSummary).toHaveBeenCalledTimes(2)
    })
  })

  describe('stale responses across a project switch', () => {
    it('does not patch another project with a late response', async () => {
      const projectId = shallowRef<string | undefined>('project-stale-1')
      const deferred = createDeferred<VersionResult>()

      mocks.fetchMock.mockReturnValueOnce(deferred.promise)

      const knowledge = useProjectKnowledge(projectId)
      const pendingOutcome = knowledge.removeItem('item-1')

      projectId.value = 'project-stale-2'
      summaryData.value = createSummary({
        projectId: 'project-stale-2',
        version: 10,
        items: [createItem({ id: 'item-1', projectId: 'project-stale-2' })],
      })

      deferred.resolve({ version: 11, packVersion: 11 })

      const outcome = await pendingOutcome

      expect(outcome.ok).toBe(true)
      expect(summaryData.value?.version).toBe(10)
      expect(summaryData.value?.items).toHaveLength(1)
    })

    it('targets the project that was current when the call was made', async () => {
      const projectId = shallowRef<string | undefined>('project-stale-3')

      mocks.fetchMock.mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge(projectId)
      const pendingOutcome = knowledge.removeItem('item-1')

      projectId.value = 'project-stale-4'
      await pendingOutcome

      expect(mocks.fetchMock.mock.calls[0]?.[0]).toBe(
        '/api/v1/projects/project-stale-3/knowledge/items/item-1',
      )
    })
  })

  describe('error mapping', () => {
    const mutationCases: Array<{
      name: string
      run: (knowledge: ReturnType<typeof useProjectKnowledge>) => Promise<{
        ok: boolean
      }>
    }> = [
      {
        name: 'addItems',
        run: knowledge => knowledge.addItems([{
          title: 'a.md',
          mediaType: 'text/markdown',
          extractor: 'text',
          extractStatus: 'ready',
          text: 'hello',
        }]),
      },
      { name: 'removeItem', run: knowledge => knowledge.removeItem('item-1') },
      {
        name: 'patchItem',
        run: knowledge => knowledge.patchItem('item-1', { pinned: true }),
      },
      {
        name: 'createNote',
        run: knowledge => knowledge.createNote({ title: 'T', body: 'B' }),
      },
      {
        name: 'updateNote',
        run: knowledge => knowledge.updateNote('item-1', { title: 'T2' }),
      },
      { name: 'getItemText', run: knowledge => knowledge.getItemText('item-1') },
      { name: 'commit', run: knowledge => knowledge.commit({}) },
      { name: 'setMode', run: knowledge => knowledge.setMode('full') },
    ]

    it.each(mutationCases)(
      '$name maps a failure through parseError',
      async ({ run }) => {
        mocks.fetchMock.mockRejectedValueOnce(createQuotaFetchError())

        const knowledge = useProjectKnowledge('project-errors')
        const outcome = await run(knowledge)

        expect(outcome.ok).toBe(false)

        if (outcome.ok) {
          return
        }

        const { parsed } = outcome as unknown as {
          parsed: { message: string, status: number, why?: string }
        }

        expect(parsed.message).toBe('Not enough storage space')
        expect(parsed.status).toBe(413)
        expect(parsed.why).toBe('The project quota is full')
      },
    )
  })

  describe('request shapes and local patches', () => {
    it('addItems posts the batch and merges the created items', async () => {
      const created = createItem({
        id: 'item-2',
        title: 'b.md',
        textBytes: 50,
        latinChars: 50,
        cyrillicChars: 0,
        otherChars: 0,
      })

      mocks.fetchMock.mockResolvedValueOnce({
        items: [created],
        skipped: [{ index: 1, reason: 'duplicate' }],
        version: 4,
        packVersion: null,
      })

      const knowledge = useProjectKnowledge('project-shape-1')
      const inputs = [
        {
          title: 'b.md',
          mediaType: 'text/markdown',
          extractor: 'text' as const,
          extractStatus: 'ready' as const,
          text: 'hello',
        },
        {
          title: 'dup.md',
          mediaType: 'text/markdown',
          extractor: 'text' as const,
          extractStatus: 'ready' as const,
          text: 'hello',
        },
      ]
      const outcome = await knowledge.addItems(inputs, { commit: true })

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-1/knowledge/items',
        { method: 'POST', body: { items: inputs, commit: true } },
      )
      expect(outcome.ok).toBe(true)
      expect(summaryData.value?.items.map(item => item.id)).toEqual([
        'item-1',
        'item-2',
      ])
      expect(summaryData.value?.totals).toMatchObject({
        textBytes: 150,
        items: 2,
      })
      expect(summaryData.value?.version).toBe(4)
      expect(summaryData.value?.packVersion).toBeNull()
    })

    it('addItems omits commit unless requested', async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        items: [],
        skipped: [],
        version: 3,
        packVersion: 3,
      })

      const knowledge = useProjectKnowledge('project-shape-2')

      await knowledge.addItems([])

      expect(mocks.fetchMock.mock.calls[0]?.[1]).toEqual({
        method: 'POST',
        body: { items: [] },
      })
    })

    it('removeItem deletes the item and updates version and totals', async () => {
      summaryData.value = createSummary({
        items: [
          createItem({ id: 'item-1', textBytes: 100 }),
          createItem({ id: 'item-2', textBytes: 40 }),
        ],
      })
      mocks.fetchMock.mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge('project-shape-3')
      const outcome = await knowledge.removeItem('item-1')

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-3/knowledge/items/item-1',
        { method: 'DELETE' },
      )
      expect(outcome).toEqual({
        ok: true,
        result: { version: 4, packVersion: 4 },
      })
      expect(summaryData.value?.items.map(item => item.id)).toEqual(['item-2'])
      expect(summaryData.value?.totals.textBytes).toBe(40)
      expect(summaryData.value?.version).toBe(4)
    })

    it('patchItem sends the patch and replaces the item', async () => {
      const patched = createItem({ description: 'Short', pinned: true })

      mocks.fetchMock.mockResolvedValueOnce(patched)

      const knowledge = useProjectKnowledge('project-shape-4')
      const outcome = await knowledge.patchItem('item-1', {
        description: 'Short',
        pinned: true,
      })

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-4/knowledge/items/item-1',
        { method: 'PATCH', body: { description: 'Short', pinned: true } },
      )
      expect(outcome).toEqual({ ok: true, result: patched })
      expect(summaryData.value?.items[0]?.pinned).toBe(true)
      expect(summaryData.value?.items).toHaveLength(1)
    })

    it('createNote posts the note, appends it and refreshes', async () => {
      const note = createItem({ id: 'note-1', kind: 'note', title: 'Plan' })

      mocks.fetchMock.mockResolvedValueOnce(note)

      const knowledge = useProjectKnowledge('project-shape-5')
      const outcome = await knowledge.createNote({
        title: 'Plan',
        body: 'Ship it',
      })

      await flushAsync()

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-5/knowledge/notes',
        { method: 'POST', body: { title: 'Plan', body: 'Ship it' } },
      )
      expect(outcome).toEqual({ ok: true, result: note })
      expect(summaryData.value?.items.map(item => item.id)).toEqual([
        'item-1',
        'note-1',
      ])
      expect(refreshSummary).toHaveBeenCalled()
    })

    it('updateNote patches the note and refreshes', async () => {
      const note = createItem({ id: 'item-1', kind: 'note', title: 'Renamed' })

      mocks.fetchMock.mockResolvedValueOnce(note)

      const knowledge = useProjectKnowledge('project-shape-6')
      const outcome = await knowledge.updateNote('item-1', {
        title: 'Renamed',
      })

      await flushAsync()

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-6/knowledge/notes/item-1',
        { method: 'PATCH', body: { title: 'Renamed' } },
      )
      expect(outcome.ok).toBe(true)
      expect(summaryData.value?.items[0]?.title).toBe('Renamed')
      expect(refreshSummary).toHaveBeenCalled()
    })

    it('does not refresh after a failed note mutation', async () => {
      mocks.fetchMock.mockRejectedValueOnce(createQuotaFetchError())

      const knowledge = useProjectKnowledge('project-shape-7')

      await knowledge.createNote({ title: 'Plan', body: 'Ship it' })
      await flushAsync()

      expect(refreshSummary).not.toHaveBeenCalled()
    })

    it('getItemText reads the text without joining the mutation chain', async () => {
      const pendingMutation = createDeferred<VersionResult>()

      mocks.fetchMock
        .mockReturnValueOnce(pendingMutation.promise)
        .mockResolvedValueOnce({ text: '# Heading' })

      const knowledge = useProjectKnowledge('project-shape-8')
      const mutation = knowledge.removeItem('item-1')

      await flushAsync()

      const textOutcome = await knowledge.getItemText('item/1')

      expect(textOutcome).toEqual({ ok: true, result: { text: '# Heading' } })
      expect(mocks.fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/v1/projects/project-shape-8/knowledge/items/item%2F1/text',
      )

      pendingMutation.resolve({ version: 4, packVersion: 4 })
      await mutation
    })

    it('commit posts the body and drops the removed items', async () => {
      summaryData.value = createSummary({
        items: [
          createItem({ id: 'item-1', folderId: 'folder1' }),
          createItem({ id: 'item-2', folderId: 'folder1' }),
          createItem({ id: 'item-3' }),
        ],
      })
      mocks.fetchMock.mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge('project-shape-9')
      const body = { folderId: 'folder1', remove: ['item-1', 'item-2'] }
      const outcome = await knowledge.commit(body)

      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project-shape-9/knowledge/commit',
        { method: 'POST', body },
      )
      expect(outcome.ok).toBe(true)
      expect(summaryData.value?.items.map(item => item.id)).toEqual(['item-3'])
      expect(summaryData.value?.version).toBe(4)
    })

    it('commit sends an empty body by default', async () => {
      mocks.fetchMock.mockResolvedValueOnce({ version: 4, packVersion: 4 })

      const knowledge = useProjectKnowledge('project-shape-10')

      await knowledge.commit()

      expect(mocks.fetchMock.mock.calls[0]?.[1]).toEqual({
        method: 'POST',
        body: {},
      })
    })
  })
})
