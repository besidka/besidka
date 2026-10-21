import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { useProjectPicker } from '../../../app/composables/project-picker'
import {
  createProject,
  createProjectsResponse,
} from '../../setup/helpers/history-fixtures'

const SEARCH_DEBOUNCE_MS = 180

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return {
    promise,
    resolve,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

const scopes: EffectScope[] = []

function createPickerComposable() {
  const scope = effectScope()
  const picker = scope.run(() => useProjectPicker())

  scopes.push(scope)

  if (!picker) {
    throw new Error('Failed to create project picker composable')
  }

  return picker
}

describe('useProjectPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    fetchMock.mockReset()
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => {
      scope.stop()
    })
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('requests the first page with the page size and no cursor', async () => {
    const pinnedProject = createProject({
      id: 'project-pinned',
      pinnedAt: '2026-03-01T10:00:00.000Z',
    })
    const firstProject = createProject({ id: 'project-1' })
    fetchMock.mockResolvedValue(createProjectsResponse({
      pinned: [pinnedProject],
      projects: [firstProject],
      nextCursor: 'cursor-1',
    }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects', {
      query: {
        limit: 30,
        sortBy: 'activity',
      },
    })
    expect(picker.pinned.value).toEqual([pinnedProject])
    expect(picker.projects.value).toEqual([firstProject])
    expect(picker.hasMore.value).toBe(true)
    expect(picker.isLoadingInitial.value).toBe(false)
  })

  it('loads the next page with the cursor and keeps pinned projects', async () => {
    const pinnedProject = createProject({
      id: 'project-pinned',
      pinnedAt: '2026-03-01T10:00:00.000Z',
    })
    const firstProject = createProject({ id: 'project-1' })
    const secondProject = createProject({ id: 'project-2' })
    fetchMock
      .mockResolvedValueOnce(createProjectsResponse({
        pinned: [pinnedProject],
        projects: [firstProject],
        nextCursor: 'cursor-1',
      }))
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [secondProject],
        nextCursor: null,
      }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()

    expect(picker.pageVersion.value).toBe(1)

    await picker.loadMore()

    expect(picker.pageVersion.value).toBe(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects', {
      query: {
        limit: 30,
        sortBy: 'activity',
        cursor: 'cursor-1',
      },
    })
    expect(picker.pinned.value).toEqual([pinnedProject])
    expect(picker.projects.value).toEqual([firstProject, secondProject])
    expect(picker.hasMore.value).toBe(false)
    expect(picker.isLoadingMore.value).toBe(false)
  })

  it('does nothing in loadMore when there is no cursor', async () => {
    fetchMock.mockResolvedValue(createProjectsResponse({
      projects: [createProject({ id: 'project-1' })],
      nextCursor: null,
    }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()
    await picker.loadMore()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('debounces search, sends it trimmed and replaces the list', async () => {
    const firstProject = createProject({ id: 'project-1', name: 'Alpha' })
    const matchedProject = createProject({ id: 'project-2', name: 'Beta' })
    fetchMock
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [firstProject],
        nextCursor: 'cursor-1',
      }))
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [matchedProject],
        nextCursor: null,
      }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()

    picker.search.value = ' B '
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects', {
      query: {
        limit: 30,
        sortBy: 'activity',
        search: 'B',
      },
    })
    expect(picker.projects.value).toEqual([matchedProject])
    expect(picker.hasMore.value).toBe(false)
    expect(picker.isSearching.value).toBe(false)
  })

  it('drops the response of an earlier search superseded by a newer one', async () => {
    const staleDeferred = createDeferred<
      ReturnType<typeof createProjectsResponse>
    >()
    const staleProject = createProject({ id: 'project-stale', name: 'Al' })
    const freshProject = createProject({ id: 'project-fresh', name: 'Alpha' })
    fetchMock
      .mockResolvedValueOnce(createProjectsResponse())
      .mockImplementationOnce(() => staleDeferred.promise)
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [freshProject],
      }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()

    picker.search.value = 'Al'
    await flushPromises()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    await flushPromises()

    picker.search.value = 'Alpha'
    await flushPromises()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    await flushPromises()

    expect(picker.projects.value).toEqual([freshProject])

    staleDeferred.resolve(createProjectsResponse({
      projects: [staleProject],
      nextCursor: 'stale-cursor',
    }))
    await flushPromises()

    expect(picker.projects.value).toEqual([freshProject])
    expect(picker.hasMore.value).toBe(false)
  })

  it('drops a late loadMore response after the query changed', async () => {
    const loadMoreDeferred = createDeferred<
      ReturnType<typeof createProjectsResponse>
    >()
    const firstProject = createProject({ id: 'project-1', name: 'Alpha' })
    const lateProject = createProject({ id: 'project-late', name: 'Late' })
    const searchedProject = createProject({ id: 'project-2', name: 'Beta' })
    fetchMock
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [firstProject],
        nextCursor: 'cursor-1',
      }))
      .mockImplementationOnce(() => loadMoreDeferred.promise)
      .mockResolvedValueOnce(createProjectsResponse({
        projects: [searchedProject],
      }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()

    const pendingLoadMore = picker.loadMore()

    picker.search.value = 'Beta'
    await flushPromises()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    await flushPromises()

    loadMoreDeferred.resolve(createProjectsResponse({
      projects: [lateProject],
      nextCursor: 'cursor-2',
    }))
    await pendingLoadMore

    expect(picker.projects.value).toEqual([searchedProject])
    expect(picker.hasMore.value).toBe(false)
    expect(picker.isLoadingMore.value).toBe(false)
  })

  it('prepends a newly created project', async () => {
    const existingProject = createProject({ id: 'project-1' })
    const createdProject = createProject({ id: 'project-new' })
    fetchMock.mockResolvedValue(createProjectsResponse({
      projects: [existingProject],
    }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()
    picker.prependProject(createdProject)

    expect(picker.projects.value).toEqual([createdProject, existingProject])
  })

  it('resets state without refetching when the search is cleared', async () => {
    fetchMock.mockResolvedValue(createProjectsResponse({
      projects: [createProject({ id: 'project-1' })],
      nextCursor: 'cursor-1',
    }))

    const picker = createPickerComposable()

    await picker.fetchFirstPage()
    picker.search.value = 'Al'
    picker.reset()
    await flushPromises()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(picker.projects.value).toEqual([])
    expect(picker.hasMore.value).toBe(false)
    expect(picker.search.value).toBe('')
  })
})
