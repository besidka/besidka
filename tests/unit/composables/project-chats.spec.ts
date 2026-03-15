import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useProjectChats } from '../../../app/composables/project-chats'
import {
  createProject,
  createProjectChatsResponse,
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject,
  }
}

const scopes: EffectScope[] = []

function createProjectChatsComposable(
  projectId: ReturnType<typeof ref<string>>,
) {
  const scope = effectScope()
  const projectChats = scope.run(() => useProjectChats(projectId))

  scopes.push(scope)

  if (!projectChats) {
    throw new Error('Failed to create project chats composable')
  }

  return projectChats
}

describe('useProjectChats', () => {
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates project chats cache and loads more pages', async () => {
    const projectId = ref('project-1')
    const project = createProject({ id: 'project-1', name: 'Project one' })
    const cachedChat = createHistoryChat({ id: 'chat-1', title: 'Cached chat' })
    const nextChat = createHistoryChat({ id: 'chat-2', title: 'Next chat' })
    const fetchMock = vi.fn(() => {
      return Promise.resolve(createProjectChatsResponse({
        project,
        chats: [nextChat],
        nextCursor: null,
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const firstProjectChats = useProjectChats(projectId)
    firstProjectChats.prime(createProjectChatsResponse({
      project,
      chats: [cachedChat],
      nextCursor: '2026-03-10T10:00:00.000Z',
    }))

    const secondProjectChats = useProjectChats(projectId)
    await secondProjectChats.loadMore()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/project-1/chats', {
      query: { cursor: '2026-03-10T10:00:00.000Z' },
    })
    expect(secondProjectChats.chats.value).toEqual([cachedChat, nextChat])
    expect(secondProjectChats.hasMore.value).toBe(false)
  })

  it('renames, removes, and moves chats based on project membership', () => {
    const projectId = ref('project-1')
    const project = createProject({ id: 'project-1' })
    const firstChat = createHistoryChat({ id: 'chat-1', projectId: 'project-1' })
    const secondChat = createHistoryChat({
      id: 'chat-2',
      projectId: 'project-1',
      activityAt: '2026-03-11T09:00:00.000Z',
    })

    const projectChats = useProjectChats(projectId)
    projectChats.prime(createProjectChatsResponse({
      project,
      chats: [secondChat, firstChat],
    }))

    projectChats.renameChat('chat-1', 'Renamed chat')
    expect(projectChats.chats.value[0]?.id).toBe('chat-1')
    expect(projectChats.chats.value[0]?.title).toBe('Renamed chat')

    projectChats.moveChat('chat-1', null)
    expect(projectChats.chats.value.map(chat => chat.id)).toEqual(['chat-2'])

    projectChats.removeChat('chat-2')
    expect(projectChats.chats.value).toEqual([])
  })

  it('re-buckets pinned chats and updates project metadata', () => {
    const projectId = ref('project-1')
    const project = createProject({ id: 'project-1', name: 'Inbox' })
    const chat = createHistoryChat({ id: 'chat-1', projectId: 'project-1' })

    const projectChats = useProjectChats(projectId)
    projectChats.prime(createProjectChatsResponse({
      project,
      chats: [chat],
    }))

    projectChats.togglePin('chat-1', '2026-03-11T10:00:00.000Z')
    expect(projectChats.pinned.value[0]?.id).toBe('chat-1')
    expect(projectChats.chats.value).toEqual([])

    projectChats.togglePin('chat-1', null)
    expect(projectChats.chats.value[0]?.id).toBe('chat-1')
    expect(projectChats.pinned.value).toEqual([])

    projectChats.updateProject({
      ...project,
      name: 'Inbox renamed',
    })
    expect(projectChats.project.value?.name).toBe('Inbox renamed')
  })

  it('uses separate cache entries per project id', async () => {
    const firstProject = createProject({ id: 'project-1', name: 'Project one' })
    const secondProject = createProject({ id: 'project-2', name: 'Project two' })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/projects/project-2/chats') {
        return Promise.resolve(createProjectChatsResponse({
          project: secondProject,
          chats: [createHistoryChat({ id: 'chat-2', projectId: 'project-2' })],
        }))
      }

      return Promise.resolve(createProjectChatsResponse({
        project: firstProject,
        chats: [createHistoryChat({ id: 'chat-1', projectId: 'project-1' })],
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const firstProjectId = ref('project-1')
    const firstProjectChats = useProjectChats(firstProjectId)
    firstProjectChats.prime(createProjectChatsResponse({
      project: firstProject,
      chats: [createHistoryChat({ id: 'chat-1', projectId: 'project-1' })],
    }))

    const secondProjectId = ref('project-2')
    const secondProjectChats = useProjectChats(secondProjectId)
    await secondProjectChats.hydrateAndRefresh()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/project-2/chats', {
      query: undefined,
    })
    expect(secondProjectChats.project.value?.id).toBe('project-2')

    const remountedFirstProjectChats = useProjectChats(firstProjectId)
    await remountedFirstProjectChats.hydrateAndRefresh()

    expect(remountedFirstProjectChats.project.value?.id).toBe('project-1')
  })

  it('queues the active project refresh after navigating away mid-request', async () => {
    const projectA = createProject({ id: 'project-a', name: 'Project A' })
    const projectB = createProject({ id: 'project-b', name: 'Project B' })
    const projectARequest = createDeferred<
      ReturnType<typeof createProjectChatsResponse>
    >()
    const projectBRequest = createDeferred<
      ReturnType<typeof createProjectChatsResponse>
    >()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/projects/project-a/chats') {
        return projectARequest.promise
      }

      if (url === '/api/v1/projects/project-b/chats') {
        return projectBRequest.promise
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    const projectId = ref('project-a')

    vi.stubGlobal('$fetch', fetchMock)

    const projectChats = useProjectChats(projectId)
    const firstRequest = projectChats.hydrateAndRefresh()

    projectId.value = 'project-b'
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(projectChats.project.value).toBeNull()

    projectARequest.resolve(createProjectChatsResponse({
      project: projectA,
      chats: [createHistoryChat({ id: 'chat-a', projectId: 'project-a' })],
    }))
    await Promise.resolve()
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/projects/project-b/chats', {
      query: undefined,
    })

    projectBRequest.resolve(createProjectChatsResponse({
      project: projectB,
      chats: [createHistoryChat({ id: 'chat-b', projectId: 'project-b' })],
    }))
    await firstRequest
    await Promise.resolve()
    await nextTick()

    expect(projectChats.project.value?.id).toBe('project-b')
    expect(projectChats.chats.value.map(chat => chat.id)).toEqual(['chat-b'])

    projectId.value = 'project-a'
    await nextTick()

    expect(projectChats.hasCachedData.value).toBe(true)
    expect(projectChats.project.value?.id).toBe('project-a')
    expect(projectChats.chats.value.map(chat => chat.id)).toEqual(['chat-a'])
  })

  it('blocks load-more while a cached refresh is already in flight', async () => {
    const projectId = ref('project-1')
    const project = createProject({ id: 'project-1', name: 'Project one' })
    const refreshDeferred = createDeferred<
      ReturnType<typeof createProjectChatsResponse>
    >()
    const fetchMock = vi.fn(() => refreshDeferred.promise)

    vi.stubGlobal('$fetch', fetchMock)

    const projectChats = createProjectChatsComposable(projectId)
    projectChats.prime(createProjectChatsResponse({
      project,
      chats: [createHistoryChat({ id: 'chat-cached' })],
      nextCursor: '2026-03-10T10:00:00.000Z',
    }))

    const refreshRequest = projectChats.hydrateAndRefresh()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await projectChats.loadMore()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    refreshDeferred.resolve(createProjectChatsResponse({
      project,
      chats: [createHistoryChat({ id: 'chat-fresh' })],
      nextCursor: null,
    }))
    await refreshRequest

    expect(projectChats.chats.value.map(chat => chat.id)).toEqual([
      'chat-fresh',
    ])
    expect(projectChats.nextCursor.value).toBeNull()
  })
})
