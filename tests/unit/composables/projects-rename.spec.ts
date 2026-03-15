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

describe('useProjects rename behavior', () => {
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

  it('removes a renamed project that no longer matches the active search', async () => {
    const matchingProject = createProject({
      id: 'project-1',
      name: 'Projects',
    })
    vi.stubGlobal('$fetch', vi.fn(() => {
      return Promise.resolve({ success: true })
    }))

    const projects = createProjectsComposable()
    projects.search.value = 'proj'
    projects.prime(createProjectsResponse({ projects: [matchingProject] }))

    await projects.renameProject('project-1', 'Inbox')

    expect(projects.projects.value).toEqual([])
  })
})
