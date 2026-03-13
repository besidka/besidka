import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useProjects } from '../../../app/composables/projects'
import {
  createProject,
  createProjectsResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

function flushPromises() {
  return Promise.resolve()
}

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

const scopes: EffectScope[] = []

function createProjectsComposable() {
  const scope = effectScope()
  const projects = scope.run(() => useProjects())

  scopes.push(scope)

  if (!projects) {
    throw new Error('Failed to create projects composable')
  }

  return projects
}

describe('useProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'))
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => {
      scope.stop()
    })
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates cached projects immediately and refreshes in the background', async () => {
    const cachedProject = createProject({
      id: 'project-cached',
      name: 'Cached project',
    })
    const freshProject = createProject({
      id: 'project-fresh',
      name: 'Fresh project',
    })
    const deferred = createDeferred<ReturnType<typeof createProjectsResponse>>()
    const fetchMock = vi.fn(() => deferred.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const firstProjects = createProjectsComposable()
    firstProjects.prime(createProjectsResponse({ projects: [cachedProject] }))

    const secondProjects = createProjectsComposable()
    const refreshPromise = secondProjects.hydrateAndRefresh()

    expect(secondProjects.projects.value).toEqual([cachedProject])
    expect(secondProjects.isRefreshing.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects', {
      query: { sortBy: 'activity' },
    })

    deferred.resolve(createProjectsResponse({ projects: [freshProject] }))
    await refreshPromise

    expect(secondProjects.projects.value).toEqual([freshProject])
  })

  it('creates, renames, pins, archives, and deletes projects', async () => {
    const project = createProject({ id: 'project-1', name: 'Inbox' })
    const createdProject = createProject({ id: 'project-2', name: 'Projects' })
    vi.stubGlobal('$fetch', vi.fn((url: string) => {
      if (url === '/api/v1/projects') {
        return Promise.resolve(createdProject)
      }

      if (url.endsWith('/pin')) {
        return Promise.resolve({ pinnedAt: '2026-03-11T10:00:00.000Z' })
      }

      if (url.endsWith('/archive')) {
        return Promise.resolve({ archivedAt: '2026-03-11T11:00:00.000Z' })
      }

      return Promise.resolve({ success: true })
    }))

    const projects = createProjectsComposable()
    projects.prime(createProjectsResponse({ projects: [project] }))

    const result = await projects.createProject('Projects')

    expect(result).toEqual(createdProject)
    expect(projects.projects.value[0]?.id).toBe('project-2')

    await projects.renameProject('project-1', 'Inbox renamed')
    expect(projects.projects.value.find(project => project.id === 'project-1'))
      .toMatchObject({ name: 'Inbox renamed' })

    await projects.togglePin('project-1')
    expect(projects.pinned.value[0]?.id).toBe('project-1')

    await projects.toggleArchive('project-1')
    expect(projects.pinned.value).toHaveLength(0)

    await projects.deleteProject('project-2')
    expect(projects.projects.value.map(project => project.id)).toEqual([])
  })

  it('re-sorts pinned projects when pinning while sorting by name', async () => {
    const alphaProject = createProject({ id: 'project-1', name: 'Alpha' })
    const zuluProject = createProject({
      id: 'project-2',
      name: 'Zulu',
      pinnedAt: '2026-03-10T10:00:00.000Z',
    })
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/projects' && !options?.method) {
        return Promise.resolve(createProjectsResponse({
          projects: [alphaProject],
          pinned: [zuluProject],
        }))
      }

      return Promise.resolve({ pinnedAt: '2026-03-11T10:00:00.000Z' })
    }))

    const projects = createProjectsComposable()
    projects.sortBy.value = 'name'
    await flushPromises()
    await flushPromises()

    await projects.togglePin('project-1')

    expect(projects.projects.value).toEqual([])
    expect(projects.pinned.value.map(project => project.name)).toEqual([
      'Alpha',
      'Zulu',
    ])
  })

  it('re-sorts projects when unpinning while sorting by activity', async () => {
    const newestProject = createProject({
      id: 'project-1',
      name: 'Newest',
      activityAt: '2026-03-11T09:00:00.000Z',
    })
    const middleProject = createProject({
      id: 'project-2',
      name: 'Middle',
      activityAt: '2026-03-10T09:00:00.000Z',
    })
    const oldestPinnedProject = createProject({
      id: 'project-3',
      name: 'Oldest',
      activityAt: '2026-03-09T09:00:00.000Z',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    })
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/projects' && !options?.method) {
        return Promise.resolve(createProjectsResponse({
          projects: [newestProject, middleProject],
          pinned: [oldestPinnedProject],
        }))
      }

      return Promise.resolve({ pinnedAt: null })
    }))

    const projects = createProjectsComposable()
    projects.sortBy.value = 'activity'
    await flushPromises()
    await flushPromises()

    await projects.togglePin('project-3')

    expect(projects.pinned.value).toEqual([])
    expect(projects.projects.value.map(project => project.id)).toEqual([
      'project-1',
      'project-2',
      'project-3',
    ])
  })

  it('does not insert a created project into a filtered view when it does not match', async () => {
    vi.useFakeTimers()

    const visibleProject = createProject({ id: 'project-1', name: 'Alpha' })
    const createdProject = createProject({ id: 'project-2', name: 'Projects' })
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/projects' && options?.method === 'PUT') {
        return Promise.resolve(createdProject)
      }

      return Promise.resolve(createProjectsResponse({
        projects: [visibleProject],
      }))
    }))

    const projects = createProjectsComposable()
    projects.search.value = 'Alpha'
    projects.prime(createProjectsResponse({ projects: [visibleProject] }))

    const result = await projects.createProject('Projects')

    expect(result).toEqual(createdProject)
    expect(projects.projects.value).toEqual([visibleProject])
  })

  it('debounces search and includes sort and archive filters in requests', async () => {
    vi.useFakeTimers()

    const activeProject = createProject({ id: 'project-active', name: 'Alpha' })
    const archivedProject = createProject({
      id: 'project-archived',
      name: 'Archive',
      archivedAt: '2026-03-01T10:00:00.000Z',
    })
    const fetchMock = vi.fn((url: string, options?: {
      query?: {
        archived?: string
        search?: string
        sortBy?: string
      }
    }) => {
      if (options?.query?.archived === 'true') {
        return Promise.resolve(createProjectsResponse({
          projects: [archivedProject],
        }))
      }

      if (options?.query?.search === 'Alpha') {
        return Promise.resolve(createProjectsResponse({
          projects: [activeProject],
        }))
      }

      return Promise.resolve(createProjectsResponse({
        projects: [activeProject],
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const projects = createProjectsComposable()
    projects.sortBy.value = 'activity'
    await flushPromises()
    await flushPromises()
    await projects.hydrateAndRefresh()

    projects.search.value = 'Alpha'
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects', {
      query: {
        search: 'Alpha',
        sortBy: 'activity',
      },
    })

    projects.sortBy.value = 'name'
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects', {
      query: {
        search: 'Alpha',
        sortBy: 'name',
      },
    })

    projects.showArchived.value = true
    await projects.hydrateAndRefresh()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects', {
      query: {
        search: 'Alpha',
        sortBy: 'name',
        archived: 'true',
      },
    })
    expect(projects.projects.value).toEqual([archivedProject])
  })
})
