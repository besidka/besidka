<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      data-testid="project-picker-dialog"
      class="modal modal-bottom sm:modal-middle"
    >
      <div class="modal-box max-w-2xl">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="font-bold text-lg">
              Move to project
            </h3>
            <p class="text-sm opacity-60 mt-1">
              Choose where this chat should live.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="openCreateModal"
          >
            <Icon name="lucide:plus" size="14" />
            New project
          </button>
        </div>

        <UiSearchInput
          ref="searchInputRef"
          v-model="search"
          :is-searching="isSearching"
          placeholder="Search projects..."
          :show-keyboard-hint="false"
          class="mb-4"
        />

        <div
          ref="scrollContainerRef"
          data-testid="project-picker-list"
          class="rounded-box border border-base-200 max-h-80 overflow-y-auto p-2"
        >
          <div
            v-if="isLoadingInitial"
            class="flex items-center justify-center py-8"
          >
            <span class="loading loading-spinner loading-md" />
          </div>

          <template v-else>
            <ul class="menu menu-sm w-full gap-1">
              <li v-if="currentProject">
                <h4 class="menu-title px-2">Current</h4>
                <button
                  type="button"
                  class="menu-active"
                  @click="onSelect(currentProject.id, currentProject.name)"
                >
                  <Icon name="lucide:check" size="14" />
                  <span class="flex items-center gap-1">
                    <Icon name="lucide:folder-open" size="14" />
                    {{ currentProject.name }}
                  </span>
                </button>
              </li>

              <li>
                <h4 class="menu-title px-2">Actions</h4>
                <button
                  type="button"
                  :class="{ 'menu-active': !currentChat?.projectId }"
                  @click="onSelect(null, null)"
                >
                  <Icon
                    :name="currentChat?.projectId
                      ? 'lucide:x-circle'
                      : 'lucide:check'"
                    size="14"
                  />
                  No project
                </button>
              </li>

              <li v-if="visiblePinnedProjects.length > 0">
                <h4 class="menu-title px-2">Pinned projects</h4>
                <button
                  v-for="project in visiblePinnedProjects"
                  :key="project.id"
                  data-testid="project-picker-item"
                  type="button"
                  :class="{
                    'menu-active': project.id === currentChat?.projectId,
                  }"
                  @click="onSelect(project.id, project.name)"
                >
                  <Icon
                    :name="project.id === currentChat?.projectId
                      ? 'lucide:folder-open'
                      : 'lucide:folder'"
                    size="14"
                  />
                  <span class="flex-1 text-left">{{ project.name }}</span>
                  <Icon name="lucide:pin" size="12" class="opacity-50" />
                </button>
              </li>

              <li v-if="visibleProjects.length > 0">
                <h4 class="menu-title px-2">All projects</h4>
                <button
                  v-for="project in visibleProjects"
                  :key="project.id"
                  data-testid="project-picker-item"
                  type="button"
                  :class="{
                    'menu-active': project.id === currentChat?.projectId,
                  }"
                  @click="onSelect(project.id, project.name)"
                >
                  <Icon
                    :name="project.id === currentChat?.projectId
                      ? 'lucide:folder-open'
                      : 'lucide:folder'"
                    size="14"
                  />
                  {{ project.name }}
                </button>
              </li>
            </ul>

            <div
              v-if="!hasVisibleProjects"
              class="px-4 py-8 text-center"
            >
              <Icon
                name="lucide:search"
                size="36"
                class="mx-auto mb-3 opacity-40"
              />
              <p class="font-medium">
                {{
                  search.length
                    ? 'No projects match your search'
                    : 'No projects yet'
                }}
              </p>
              <p class="mt-2 text-sm opacity-60">
                {{ search.length
                  ? 'Try a different project name.'
                  : 'Create a project to organize chats.' }}
              </p>
            </div>

            <div
              v-if="hasMore"
              ref="sentinelRef"
              :key="pageVersion"
              class="js-project-picker-sentinel flex min-h-8 items-center justify-center py-2"
            >
              <span
                v-if="isLoadingMore"
                class="loading loading-spinner loading-sm"
              />
            </div>
          </template>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="close"
          >
            Cancel
          </button>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        @submit.prevent="close"
      >
        <button
          type="button"
          @click="close"
        >
          close
        </button>
      </form>
    </dialog>
  </Teleport>

  <ProjectsNameModal
    ref="projectNameModalRef"
    :is-submitting="isProjectModalSubmitting"
    @submit="onProjectModalSubmit"
  />
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { HistoryChat } from '#shared/types/history.d'

const emit = defineEmits<{
  submit: [payload: {
    chatId: string
    slug: string
    projectId: string | null
    projectName: string | null
  }]
}>()

const nuxtApp = useNuxtApp()

interface ProjectNameModalInstance {
  openCreate: () => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const dialogRef = shallowRef<HTMLDialogElement | null>(null)
const projectNameModalRef = shallowRef<ProjectNameModalInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const currentChat = shallowRef<HistoryChat | null>(null)
const scrollContainerRef = shallowRef<HTMLElement | null>(null)
const sentinelRef = shallowRef<HTMLElement | null>(null)
const isProjectModalSubmitting = shallowRef<boolean>(false)

const {
  search,
  pinned,
  projects,
  pageVersion,
  hasMore,
  isLoadingInitial,
  isLoadingMore,
  isSearching,
  reset,
  fetchFirstPage,
  loadMore,
  prependProject,
} = useProjectPicker()

const currentProject = computed(() => {
  const chat = currentChat.value

  if (!chat?.projectId || !chat.projectName) {
    return null
  }

  const query = search.value.trim().toLowerCase()

  if (query && !chat.projectName.toLowerCase().includes(query)) {
    return null
  }

  return {
    id: chat.projectId,
    name: chat.projectName,
  }
})

const visiblePinnedProjects = computed(() => {
  return pinned.value.filter((project) => {
    return project.id !== currentChat.value?.projectId
  })
})

const visibleProjects = computed(() => {
  return projects.value.filter((project) => {
    return project.id !== currentChat.value?.projectId
  })
})

const hasVisibleProjects = computed(() => {
  return !!currentProject.value
    || visiblePinnedProjects.value.length > 0
    || visibleProjects.value.length > 0
})

useIntersectionObserver(
  sentinelRef,
  ([entry]) => {
    if (entry?.isIntersecting) {
      loadMore()
    }
  },
  { root: scrollContainerRef },
)

watch(isSearching, async (isSearchingNow, wasSearching) => {
  if (!wasSearching || isSearchingNow) {
    return
  }

  await nextTick()

  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = 0
  }
})

async function open(chat: HistoryChat) {
  currentChat.value = chat
  reset()
  dialogRef.value?.showModal()
  await fetchFirstPage()
  await nextTick()
  searchInputRef.value?.inputRef?.focus()
}

function close() {
  dialogRef.value?.close()
  currentChat.value = null
  reset()
}

function onSelect(projectId: string | null, projectName: string | null) {
  const chat = currentChat.value

  if (!chat) return

  emit('submit', {
    chatId: chat.id,
    slug: chat.slug,
    projectId,
    projectName,
  })

  close()
}

function openCreateModal() {
  projectNameModalRef.value?.openCreate()
}

async function onProjectModalSubmit(payload: {
  mode: 'create' | 'rename'
  projectId?: string
  name: string
}) {
  if (payload.mode !== 'create') {
    return
  }

  isProjectModalSubmitting.value = true

  try {
    const project = await $fetch('/api/v1/projects', {
      method: 'PUT',
      body: { name: payload.name },
    })

    prependProject(project)
    projectNameModalRef.value?.close()
    onSelect(project.id, project.name)
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to create project',
        parsedException.why,
      )
    })
  } finally {
    isProjectModalSubmitting.value = false
  }
}

defineExpose({
  open,
  close,
})
</script>
