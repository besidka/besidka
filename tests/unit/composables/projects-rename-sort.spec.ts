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

describe('useProjects rename sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
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

  it('re-sorts renamed projects when sorting by name', async () => {
    const alphaProject = createProject({ id: 'project-1', name: 'Alpha' })
    const betaProject = createProject({ id: 'project-2', name: 'Beta' })
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      method?: string
    }) => {
      if (url === '/api/v1/projects' && !options?.method) {
        return Promise.resolve(createProjectsResponse({
          projects: [alphaProject, betaProject],
        }))
      }

      return Promise.resolve({ success: true })
    }))

    const projects = createProjectsComposable()
    projects.prime(createProjectsResponse({
      projects: [alphaProject, betaProject],
    }))

    projects.sortBy.value = 'name'
    await flushPromises()
    await flushPromises()
    await projects.renameProject('project-2', 'Aardvark')

    expect(projects.projects.value.map(project => project.name)).toEqual([
      'Aardvark',
      'Alpha',
    ])
  })
})
