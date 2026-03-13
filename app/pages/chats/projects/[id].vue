<template>
  <HistoryPageShell active-tab="projects">
    <template #title>
      <h1 class="text-4xl font-bold text-center">
        {{ project?.name || 'Project' }}
      </h1>
    </template>
    <template #subtitle>
      <div
        v-if="project?.pinnedAt || project?.archivedAt"
        class="mt-2 flex justify-center gap-2"
      >
        <span v-if="project?.pinnedAt" class="badge badge-ghost badge-sm">
          Pinned
        </span>
        <span v-if="project?.archivedAt" class="badge badge-ghost badge-sm">
          Archived
        </span>
      </div>
    </template>

    <template #toolbar>
      <div class="join flex justify-end">
        <NuxtLink
          :to="newChatInProjectUrl"
          class="btn btn-primary btn-sm join-item"
        >
          <Icon name="lucide:plus" size="14" />
          New chat in project
        </NuxtLink>
        <HistoryProjectActionsDropdown
          v-if="project"
          :project="project"
          @pin="onToggleProjectPin"
          @rename="openRenameModal"
          @archive="onToggleProjectArchive"
          @delete="onDeleteProject"
        >
          <summary
            class="btn btn-primary btn-sm btn-circle join-item"
            aria-label="Project actions"
          >
            <Icon name="lucide:ellipsis" size="16" />
          </summary>
        </HistoryProjectActionsDropdown>
      </div>
    </template>

    <ProjectsInstructionsCard
      v-model="projectInstructionsDraft"
      :is-loading="isLoadingProjectDetails"
      :is-saving="isSavingProjectInstructions"
      :has-instructions="hasProjectInstructions"
      :is-dirty="isProjectInstructionsDirty"
      @save="saveProjectInstructions"
    />

    <ProjectsMemoryCard
      :memory="projectMemory"
      :memory-status="projectMemoryStatus"
      :memory-updated-at="projectMemoryUpdatedAt"
      :memory-provider="projectMemoryProvider"
      :memory-model="projectMemoryModel"
      :memory-error="projectMemoryError"
      :is-refreshing="isRefreshingProjectMemory"
      @refresh="refreshProjectMemory"
    />

    <HistoryChatSections
      :pinned="pinned"
      :chats="chats"
      :grouped-at="groupedAt"
      :is-loading-initial="isLoadingInitial && !hasCachedData"
      :is-selection-mode="false"
      :empty-state-mode="'project'"
      :empty-action-to="newChatInProjectUrl"
      empty-action-label="New chat"
      @pin="onPin"
      @rename="openRenameChatModal"
      @delete="onDeleteChat"
      @add-to-project="openProjectPicker"
      @remove-from-project="onRemoveFromProject"
    />

    <div
      v-if="hasMore"
      ref="infiniteScrollRef"
      class="flex justify-center py-4"
    >
      <span
        v-if="isLoadingMore"
        class="loading loading-spinner loading-sm"
      />
    </div>
  </HistoryPageShell>

  <HistoryRenameModal
    ref="renameModalRef"
    @submit="onRenameChatSubmit"
  />

  <HistoryProjectNameModal
    ref="projectNameModalRef"
    :is-submitting="isProjectModalSubmitting"
    @submit="onProjectModalSubmit"
  />

  <LazyHistoryProjectPicker
    ref="projectPickerRef"
    @submit="onProjectPickerSubmit"
  />
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { Project } from '#shared/types/projects.d'
import type { HistoryChat } from '#shared/types/history.d'

definePageMeta({
  auth: {
    only: 'user',
  },
})

const route = useRoute()
const nuxtApp = useNuxtApp()
const projectId = computed(() => route.params.id as string)
const groupedAt = useState<string>('project-chats:grouped-at', () => {
  return new Date().toISOString()
})

const {
  project,
  pinned,
  chats,
  hasMore,
  hasCachedData,
  isLoadingInitial,
  isLoadingMore,
  prime,
  hydrateAndRefresh,
  loadMore,
  removeChat,
  renameChat,
  moveChat,
  togglePin,
  updateProject,
} = useProjectChats(projectId)

if (import.meta.client && !nuxtApp.isHydrating) {
  groupedAt.value = new Date().toISOString()
}

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch(`/api/v1/projects/${projectId.value}/chats`)

  prime(response)
}

useSeoMeta({
  title: () => project.value?.name || 'Project',
})

const infiniteScrollRef = shallowRef<HTMLElement | null>(null)

const newChatInProjectUrl = computed(() => {
  return `/chats/new?projectId=${projectId.value}`
})

interface RenameModalInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

interface ProjectNameModalInstance {
  openRename: (project: Project) => void
  close: () => void
}

interface ProjectPickerInstance {
  open: (chat: HistoryChat) => void
  close: () => void
}

interface ProjectDetails {
  id: string
  name: string
  instructions: string | null
  memory: string | null
  memoryStatus: Project['memoryStatus']
  memoryUpdatedAt: string | null
  memoryDirtyAt: string | null
  memoryProvider: string | null
  memoryModel: string | null
  memoryError: string | null
}

const renameModalRef = shallowRef<RenameModalInstance | null>(null)
const projectNameModalRef = shallowRef<ProjectNameModalInstance | null>(null)
const projectPickerRef = shallowRef<ProjectPickerInstance | null>(null)
const isProjectModalSubmitting = shallowRef<boolean>(false)
const isLoadingProjectDetails = shallowRef<boolean>(false)
const isSavingProjectInstructions = shallowRef<boolean>(false)
const isRefreshingProjectMemory = shallowRef<boolean>(false)
const projectInstructions = shallowRef<string | null>(null)
const projectInstructionsDraft = shallowRef<string>('')
const projectMemory = shallowRef<string | null>(null)
const projectMemoryStatus = shallowRef<Project['memoryStatus']>('idle')
const projectMemoryUpdatedAt = shallowRef<string | null>(null)
const projectMemoryProvider = shallowRef<string | null>(null)
const projectMemoryModel = shallowRef<string | null>(null)
const projectMemoryError = shallowRef<string | null>(null)
const syncedProjectDetailsId = shallowRef<string | null>(null)
let syncProjectDetailsRequestId = 0

const hasProjectInstructions = computed(() => {
  return !!projectInstructions.value?.trim()
})

const isProjectInstructionsDirty = computed(() => {
  return projectInstructionsDraft.value !== (projectInstructions.value ?? '')
})

async function fetchProjectDetails(nextProjectId: string | undefined) {
  const resolvedProjectId = nextProjectId || project.value?.id

  if (!resolvedProjectId) {
    return null
  }

  return import.meta.server
    ? await useRequestFetch()(`/api/v1/projects/${resolvedProjectId}`)
    : await $fetch(`/api/v1/projects/${resolvedProjectId}`)
}

async function syncProjectDetails(nextProjectId: string | undefined) {
  const requestedProjectId = nextProjectId || project.value?.id
  const requestId = ++syncProjectDetailsRequestId
  const shouldPreserveDraft = (
    requestedProjectId !== undefined
    && requestedProjectId === syncedProjectDetailsId.value
    && isProjectInstructionsDirty.value
  )

  isLoadingProjectDetails.value = true

  try {
    const projectDetails = (
      await fetchProjectDetails(requestedProjectId)
    ) as ProjectDetails | null

    if (requestId !== syncProjectDetailsRequestId) {
      return
    }

    if (!projectDetails) {
      projectInstructions.value = null
      if (!shouldPreserveDraft) {
        projectInstructionsDraft.value = ''
      }
      projectMemory.value = null
      projectMemoryStatus.value = 'idle'
      projectMemoryUpdatedAt.value = null
      projectMemoryProvider.value = null
      projectMemoryModel.value = null
      projectMemoryError.value = null
      syncedProjectDetailsId.value = null

      return
    }

    projectInstructions.value = projectDetails.instructions ?? null
    if (!shouldPreserveDraft) {
      projectInstructionsDraft.value = projectDetails.instructions ?? ''
    }
    projectMemory.value = projectDetails.memory ?? null
    projectMemoryStatus.value = projectDetails.memoryStatus ?? 'idle'
    projectMemoryUpdatedAt.value = projectDetails.memoryUpdatedAt ?? null
    projectMemoryProvider.value = projectDetails.memoryProvider ?? null
    projectMemoryModel.value = projectDetails.memoryModel ?? null
    projectMemoryError.value = projectDetails.memoryError ?? null
    syncedProjectDetailsId.value = projectDetails.id
  } catch (exception) {
    if (requestId !== syncProjectDetailsRequestId) {
      return
    }

    projectInstructions.value = null
    if (!shouldPreserveDraft) {
      projectInstructionsDraft.value = ''
    }
    projectMemory.value = null
    projectMemoryStatus.value = 'failed'
    projectMemoryUpdatedAt.value = null
    projectMemoryProvider.value = null
    projectMemoryModel.value = null
    projectMemoryError.value = null

    if (import.meta.client) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load project instructions',
          parsedException.why,
        )
      })
    }
  } finally {
    if (requestId === syncProjectDetailsRequestId) {
      isLoadingProjectDetails.value = false
    }
  }
}

async function refreshProjectMemory() {
  if (!project.value || isRefreshingProjectMemory.value) {
    return
  }

  isRefreshingProjectMemory.value = true

  try {
    await $fetch(`/api/v1/projects/${project.value.id}/memory/refresh`, {
      method: 'POST',
    })

    await syncProjectDetails(project.value.id)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Project memory refreshed')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to refresh project memory',
        parsedException.why,
      )
    })
  } finally {
    isRefreshingProjectMemory.value = false
  }
}

async function saveProjectInstructions() {
  if (!project.value || !isProjectInstructionsDirty.value) {
    return
  }

  isSavingProjectInstructions.value = true

  try {
    const instructions = projectInstructionsDraft.value.trim() || null

    await $fetch(`/api/v1/projects/${project.value.id}/instructions`, {
      method: 'PATCH',
      body: { instructions },
    })

    projectInstructions.value = instructions
    projectInstructionsDraft.value = instructions ?? ''

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        instructions
          ? 'Project instructions saved'
          : 'Project instructions cleared',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to save project instructions',
        parsedException.why,
      )
    })
  } finally {
    isSavingProjectInstructions.value = false
  }
}

if (import.meta.server) {
  await syncProjectDetails(projectId.value)
}

onMounted(() => {
  hydrateAndRefresh()
  syncProjectDetails(projectId.value)
})

watch(projectMemoryStatus, (nextStatus, previousStatus) => {
  if (
    !project.value
    || isRefreshingProjectMemory.value
    || !['stale', 'failed'].includes(nextStatus)
    || previousStatus === nextStatus
  ) {
    return
  }

  refreshProjectMemory()
})

watch(projectId, () => {
  groupedAt.value = new Date().toISOString()
  syncProjectDetails(projectId.value)
})

useIntersectionObserver(
  infiniteScrollRef,
  ([entry]) => {
    if (entry?.isIntersecting && hasMore.value && !isLoadingMore.value) {
      loadMore()
    }
  },
  { threshold: 0.1 },
)

function openRenameChatModal(chat: HistoryChat) {
  renameModalRef.value?.open(chat)
}

function openRenameModal() {
  if (!project.value) {
    return
  }

  projectNameModalRef.value?.openRename(project.value)
}

function openProjectPicker(chat: HistoryChat) {
  projectPickerRef.value?.open(chat)
}

async function onRenameChatSubmit(chatId: string, slug: string, title: string) {
  try {
    await $fetch(`/api/v1/chats/${slug}/rename`, {
      method: 'PATCH',
      body: { title },
    })

    renameChat(chatId, title)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Chat renamed')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to rename chat',
        parsedException.why,
      )
    })
  }

  renameModalRef.value?.close()
}

async function onDeleteChat(chatId: string, slug: string) {
  const result = await useConfirm({
    text: 'Are you sure you want to delete this chat?',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  try {
    await $fetch(`/api/v1/chats/${slug}`, {
      method: 'DELETE',
    })

    removeChat(chatId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Chat deleted')
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to delete chat',
        parsedException.why,
      )
    })
  }
}

async function onProjectPickerSubmit(payload: {
  chatId: string
  slug: string
  projectId: string | null
  projectName: string | null
}) {
  try {
    await $fetch(`/api/v1/chats/${payload.slug}/project`, {
      method: 'PATCH',
      body: { projectId: payload.projectId },
    })

    moveChat(payload.chatId, payload.projectId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        payload.projectId
          ? 'Moved to project. Future messages will use this project context.'
          : 'Removed from project. Future messages will not use project context.',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to move chat',
        parsedException.why,
      )
    })
  }
}

async function onRemoveFromProject(chatId: string, slug: string) {
  try {
    await $fetch(`/api/v1/chats/${slug}/project`, {
      method: 'PATCH',
      body: { projectId: null },
    })

    removeChat(chatId)

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        'Removed from project. Future messages will not use project context.',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to remove from project',
        parsedException.why,
      )
    })
  }
}

async function onPin(chatId: string) {
  try {
    const response = await $fetch('/api/v1/chats/history/pin', {
      method: 'POST',
      body: { chatId },
    })

    togglePin(chatId, response.pinnedAt)
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to toggle pin',
        parsedException.why,
      )
    })
  }
}

async function onProjectModalSubmit(payload: {
  mode: 'create' | 'rename'
  projectId?: string
  name: string
}) {
  if (payload.mode !== 'rename' || !payload.projectId || !project.value) {
    return
  }

  isProjectModalSubmitting.value = true

  try {
    await $fetch(`/api/v1/projects/${payload.projectId}/name`, {
      method: 'PATCH',
      body: { name: payload.name },
    })

    updateProject({
      ...project.value,
      name: payload.name,
    })

    nuxtApp.runWithContext(() => {
      useSuccessMessage('Project renamed')
    })

    projectNameModalRef.value?.close()
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to rename project',
        parsedException.why,
      )
    })
  } finally {
    isProjectModalSubmitting.value = false
  }
}

async function onToggleProjectPin() {
  if (!project.value) {
    return
  }

  try {
    const response = await $fetch(`/api/v1/projects/${project.value.id}/pin`, {
      method: 'POST',
    })

    updateProject({
      ...project.value,
      pinnedAt: response.pinnedAt,
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to toggle pin',
        parsedException.why,
      )
    })
  }
}

async function onToggleProjectArchive() {
  if (!project.value) {
    return
  }

  try {
    const response = await $fetch(`/api/v1/projects/${project.value.id}/archive`, {
      method: 'POST',
    })

    updateProject({
      ...project.value,
      archivedAt: response.archivedAt,
    })

    nuxtApp.runWithContext(() => {
      useSuccessMessage(
        response.archivedAt
          ? 'Project archived'
          : 'Project restored',
      )
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to archive project',
        parsedException.why,
      )
    })
  }
}

async function onDeleteProject() {
  if (!project.value) {
    return
  }

  const result = await useConfirm({
    text: 'Delete this project? Chats inside will not be deleted.',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) {
    return
  }

  try {
    await $fetch(`/api/v1/projects/${project.value.id}`, {
      method: 'DELETE',
    })

    navigateTo('/chats/projects')
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to delete project',
        parsedException.why,
      )
    })
  }
}
</script>
