import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemoryProjects } from '../../../app/composables/memory-projects'

interface ProjectRecord {
  id: string
  name: string
  memoryStatus: string
  extra?: number
}

interface ProjectsResponse {
  pinned: ProjectRecord[]
  projects: ProjectRecord[]
  nextCursor: null
}

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)

const activeData = shallowRef<ProjectsResponse | null>(null)
const activePending = shallowRef<boolean>(false)
const activeError = shallowRef<unknown>(null)
const activeRefresh = vi.fn()
const archivedData = shallowRef<ProjectsResponse | null>(null)
const archivedPending = shallowRef<boolean>(false)
const archivedError = shallowRef<unknown>(null)
const archivedRefresh = vi.fn()

function createResponse(
  projects: ProjectRecord[],
  pinned: ProjectRecord[] = [],
): ProjectsResponse {
  return { pinned, projects, nextCursor: null }
}

describe('useMemoryProjects', () => {
  beforeEach(() => {
    activeData.value = createResponse([{
      id: 'project-1',
      name: 'Home lab',
      memoryStatus: 'disabled',
      extra: 2,
    }], [{
      id: 'project-pinned',
      name: 'Pinned project',
      memoryStatus: 'ready',
      extra: 1,
    }])
    activePending.value = false
    activeError.value = null
    activeRefresh.mockReset()
    archivedData.value = createResponse([])
    archivedPending.value = false
    archivedError.value = null
    archivedRefresh.mockReset()
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockImplementation((
      _url: string,
      options: { query: { archived?: boolean } },
    ) => {
      if (options.query.archived) {
        return {
          data: archivedData,
          pending: archivedPending,
          error: archivedError,
          refresh: archivedRefresh,
        }
      }

      return {
        data: activeData,
        pending: activePending,
        error: activeError,
        refresh: activeRefresh,
      }
    })
  })

  it('requests up to 100 active and 100 archived projects', () => {
    useMemoryProjects()

    expect(mocks.useLazyFetch).toHaveBeenCalledWith(
      '/api/v1/projects',
      { key: 'memory-scope-projects', query: { limit: 100 } },
      expect.any(String),
    )
    expect(mocks.useLazyFetch).toHaveBeenCalledWith(
      '/api/v1/projects',
      {
        key: 'memory-scope-projects-archived',
        query: { archived: true, limit: 100 },
      },
      expect.any(String),
    )
  })

  it('lists pinned projects first with only the option fields', () => {
    const { projects } = useMemoryProjects()

    expect(projects.value).toEqual([
      {
        id: 'project-pinned',
        name: 'Pinned project',
        memoryStatus: 'ready',
        isArchived: false,
      },
      {
        id: 'project-1',
        name: 'Home lab',
        memoryStatus: 'disabled',
        isArchived: false,
      },
    ])
  })

  it('appends archived projects flagged as archived', () => {
    archivedData.value = createResponse([{
      id: 'project-old',
      name: 'Old project',
      memoryStatus: 'idle',
    }])

    const { projects } = useMemoryProjects()

    expect(projects.value.map(project => project.id))
      .toEqual(['project-pinned', 'project-1', 'project-old'])
    expect(projects.value.map(project => project.isArchived))
      .toEqual([false, false, true])
  })

  it('lists a project once when both lists carry it', () => {
    archivedData.value = createResponse([{
      id: 'project-1',
      name: 'Home lab',
      memoryStatus: 'disabled',
    }])

    const { projects } = useMemoryProjects()

    expect(projects.value.filter(project => project.id === 'project-1'))
      .toEqual([expect.objectContaining({ isArchived: false })])
  })

  it('still lists archived projects when the active request failed', () => {
    activeData.value = null
    activeError.value = new Error('Failed')
    archivedData.value = createResponse([{
      id: 'project-old',
      name: 'Old project',
      memoryStatus: 'idle',
    }])

    const { projects, error } = useMemoryProjects()

    expect(projects.value.map(project => project.id)).toEqual(['project-old'])
    expect(error.value).toBeInstanceOf(Error)
  })

  it('is empty until the projects load', () => {
    activeData.value = null
    activePending.value = true

    const { projects, isLoading } = useMemoryProjects()

    expect(projects.value).toEqual([])
    expect(isLoading.value).toBe(true)
  })

  it('is loading while only the archived projects are pending', () => {
    archivedData.value = null
    archivedPending.value = true

    const { isLoading } = useMemoryProjects()

    expect(isLoading.value).toBe(true)
  })

  it('is not loading once both lists arrived', () => {
    const { isLoading, error } = useMemoryProjects()

    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('is not loading when the requests failed', () => {
    activeData.value = null
    archivedData.value = null
    archivedError.value = new Error('Failed')

    const { isLoading, error } = useMemoryProjects()

    expect(isLoading.value).toBe(false)
    expect(error.value).toBeInstanceOf(Error)
  })

  it('refreshes both lists', async () => {
    const { refresh } = useMemoryProjects()

    await refresh()

    expect(activeRefresh).toHaveBeenCalledOnce()
    expect(archivedRefresh).toHaveBeenCalledOnce()
  })
})
