import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useProjectChats } from '../../../app/composables/project-chats'
import { useProjects } from '../../../app/composables/projects'
import { useHistory } from '../../../app/composables/history'
import {
  createProject,
  createProjectChatsResponse,
  createProjectsResponse,
  createHistoryChat,
  createHistoryResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

describe('history navigation cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      query?: {
        search?: string
        archived?: string
        sortBy?: string
      }
    }) => {
      if (url === '/api/v1/chats/history') {
        if (options?.query?.search === 'invoice') {
          return Promise.resolve(createHistoryResponse({
            chats: [createHistoryChat({ id: 'chat-search', title: 'Search' })],
          }))
        }

        return Promise.resolve(createHistoryResponse({
          chats: [createHistoryChat({ id: 'chat-default', title: 'Default' })],
        }))
      }

      if (url === '/api/v1/projects') {
        if (options?.query?.archived === 'true') {
          return Promise.resolve(createProjectsResponse({
            projects: [
              createProject({
                id: 'project-archived',
                name: 'Archived',
                archivedAt: '2026-03-01T10:00:00.000Z',
              }),
            ],
          }))
        }

        return Promise.resolve(createProjectsResponse({
          projects: [createProject({ id: 'project-active', name: 'Active' })],
        }))
      }

      return Promise.resolve(createProjectChatsResponse({
        project: createProject({ id: 'project-active', name: 'Active' }),
        chats: [createHistoryChat({ id: 'chat-1', projectId: 'project-active' })],
      }))
    }))
  })

  it('preserves history results across remounts and search keys', async () => {
    const defaultChat = createHistoryChat({ id: 'chat-default', title: 'Default' })
    const searchChat = createHistoryChat({ id: 'chat-search', title: 'Search' })

    const firstHistory = useHistory()
    firstHistory.prime(createHistoryResponse({ chats: [defaultChat] }))
    firstHistory.search.value = 'invoice'
    firstHistory.prime(createHistoryResponse({ chats: [searchChat] }))

    const secondHistory = useHistory()

    secondHistory.search.value = 'invoice'
    await secondHistory.hydrateAndRefresh()
    expect(secondHistory.hasCachedData.value).toBe(true)
    expect(secondHistory.chats.value).toEqual([searchChat])

    secondHistory.search.value = ''
    await secondHistory.hydrateAndRefresh()
    expect(secondHistory.hasCachedData.value).toBe(true)
    expect(secondHistory.chats.value).toEqual([defaultChat])
  })

  it('preserves projects and project detail caches across remounts', async () => {
    const activeProject = createProject({ id: 'project-active', name: 'Active' })
    const archivedProject = createProject({
      id: 'project-archived',
      name: 'Archived',
      archivedAt: '2026-03-01T10:00:00.000Z',
    })
    const projectChat = createHistoryChat({ id: 'chat-1', projectId: 'project-active' })
    const projectId = ref('project-active')

    const firstProjects = useProjects()
    firstProjects.prime(createProjectsResponse({ projects: [activeProject] }))
    firstProjects.showArchived.value = true
    firstProjects.prime(createProjectsResponse({ projects: [archivedProject] }))

    const firstProjectChats = useProjectChats(projectId)
    firstProjectChats.prime(createProjectChatsResponse({
      project: activeProject,
      chats: [projectChat],
    }))

    const secondProjects = useProjects()
    secondProjects.showArchived.value = true
    await secondProjects.hydrateAndRefresh()
    expect(secondProjects.hasCachedData.value).toBe(true)
    expect(secondProjects.projects.value).toEqual([archivedProject])

    secondProjects.showArchived.value = false
    await secondProjects.hydrateAndRefresh()
    expect(secondProjects.projects.value).toEqual([activeProject])

    const secondProjectChats = useProjectChats(projectId)
    expect(secondProjectChats.hasCachedData.value).toBe(true)
    expect(secondProjectChats.project.value).toEqual(activeProject)
    expect(secondProjectChats.chats.value).toEqual([projectChat])
  })
})
