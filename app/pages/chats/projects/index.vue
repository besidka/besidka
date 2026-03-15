<template>
  <HistoryPageShell active-tab="projects">
    <template #title>
      Projects
    </template>
    <template #subtitle>
      Organize your chats and keep conversations easy to find
    </template>

    <template #toolbar>
      <div class="flex flex-wrap items-center gap-2 shrink-0">
        <UiSearchInput
          ref="searchInputRef"
          v-model="search"
          :is-searching="isSearching"
          placeholder="Search projects..."
          class="flex-1 grow-2 shrink-0 min-w-48"
        />
        <div class="flex gap-2 grow">
          <select
            v-model="sortBy"
            class="select select-bordered min-w-28 grow"
          >
            <option value="activity">
              Recent
            </option>
            <option value="name">
              Name
            </option>
          </select>
          <button
            type="button"
            class="btn btn-primary max-sm:grow shrink-0 "
            :disabled="isCreating"
            @click="openCreateModal"
          >
            <span
              v-if="isCreating"
              class="loading loading-spinner loading-xs"
            />
            <Icon v-else name="lucide:plus" size="14" />
            New project
          </button>
        </div>
      </div>
    </template>

    <template #secondary-tabs>
      <div
        role="radiogroup"
        aria-label="Project visibility"
        class="tabs tabs-box tabs-sm shrink-0"
      >
        <input
          type="radio"
          name="project_visibility"
          class="tab grow"
          aria-label="Active"
          :checked="!showArchived"
          @change="showArchived = false"
        >
        <input
          type="radio"
          name="project_visibility"
          class="tab grow"
          aria-label="Archived"
          :checked="showArchived"
          @change="showArchived = true"
        >
      </div>
    </template>

    <div
      v-if="isLoadingInitial && !hasCachedData"
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="rounded-box border border-base-200/70 p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="skeleton skeleton--default size-10 rounded-2xl shrink-0" />
            <div class="flex-1 space-y-2">
              <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
              <div class="skeleton skeleton--default h-3 w-1/3 rounded-full" />
            </div>
          </div>
          <div class="skeleton skeleton--default h-9 w-9 rounded-full shrink-0" />
        </div>
      </div>
    </div>

    <template v-else>
      <template v-if="pinned.length > 0">
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
            Pinned
          </span>
          <div class="flex-1 h-px bg-base-300" />
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="project in pinned"
            :key="project.id"
            class="
              card overflow-visible bg-base-100 cursor-pointer transition-colors
              hover:bg-base-100/70 focus:outline-none focus-visible:ring-2
              focus-visible:ring-base-content/20 relative
              [&:has(details[open])]:z-30
            "
            role="link"
            tabindex="0"
            :aria-label="`Open project ${project.name}`"
            @click="onProjectCardClick($event, project.id)"
            @keydown.enter.prevent="openProject(project.id)"
            @keydown.space.prevent="openProject(project.id)"
          >
            <div class="card-body p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex flex-1 items-center gap-2 min-w-0">
                  <Icon
                    name="lucide:folder"
                    size="18"
                    class="shrink-0"
                  />
                  <span class="font-medium truncate">{{ project.name }}</span>
                </div>
                <div class="shrink-0">
                  <ProjectsActionsDropdown
                    :project="project"
                    @pin="togglePin(project.id)"
                    @rename="openRenameModal(project)"
                    @archive="toggleArchive(project.id)"
                    @delete="onDeleteProject(project.id)"
                  />
                </div>
              </div>
              <div class="text-xs opacity-50">
                {{ formatActivityAge(new Date(project.activityAt)) }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="projects.length > 0">
        <div
          v-if="pinned.length > 0"
          class="flex items-center gap-2"
        >
          <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
            All projects
          </span>
          <div class="flex-1 h-px bg-base-300" />
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="project in projects"
            :key="project.id"
            class="
              card overflow-visible bg-base-100 cursor-pointer transition-colors
              hover:bg-base-100/70 focus:outline-none focus-visible:ring-2
              focus-visible:ring-base-content/20 relative
              [&:has(details[open])]:z-30
            "
            role="link"
            tabindex="0"
            :aria-label="`Open project ${project.name}`"
            @click="onProjectCardClick($event, project.id)"
            @keydown.enter.prevent="openProject(project.id)"
            @keydown.space.prevent="openProject(project.id)"
          >
            <div class="card-body p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex flex-1 items-center gap-2 min-w-0">
                  <Icon
                    name="lucide:folder"
                    size="18"
                    class="shrink-0"
                  />
                  <span class="font-medium truncate">{{ project.name }}</span>
                </div>
                <div class="shrink-0">
                  <ProjectsActionsDropdown
                    :project="project"
                    @pin="togglePin(project.id)"
                    @rename="openRenameModal(project)"
                    @archive="toggleArchive(project.id)"
                    @delete="onDeleteProject(project.id)"
                  />
                </div>
              </div>
              <div class="text-xs opacity-50">
                {{ formatActivityAge(new Date(project.activityAt)) }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="projects.length === 0 && pinned.length === 0 && !isLoadingInitial"
        class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      >
        <template v-if="search.length >= 2">
          <Icon name="lucide:search-x" size="40" class="mx-auto mb-3 opacity-60" />
          <p class="font-medium">No projects match your search</p>
          <p class="mt-2 text-sm opacity-60">
            Try a different project name.
          </p>
        </template>
        <template v-else-if="showArchived">
          <Icon name="lucide:archive" size="40" class="mx-auto mb-3 opacity-60" />
          <p class="font-medium">No archived projects</p>
          <p class="mt-2 text-sm opacity-60">
            Archived projects will show up here.
          </p>
        </template>
        <template v-else>
          <Icon
            name="lucide:folder"
            size="40"
            class="mx-auto mb-3 opacity-60"
          />
          <p class="font-medium">Create your first project to organize chats</p>
          <p class="mt-2 mb-4 text-sm opacity-60">
            Keep related conversations together and easier to revisit.
          </p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="openCreateModal"
          >
            Create project
          </button>
        </template>
      </div>
    </template>
  </HistoryPageShell>

  <ProjectsNameModal
    ref="projectNameModalRef"
    :is-submitting="isProjectModalSubmitting"
    @submit="onProjectModalSubmit"
  />
</template>

<script setup lang="ts">
import type { Project } from '#shared/types/projects.d'
import { formatActivityAge } from '#shared/utils/date-groups'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Projects',
})

const {
  projects,
  pinned,
  search,
  sortBy,
  showArchived,
  isLoadingInitial,
  isSearching,
  isCreating,
  hasCachedData,
  prime,
  hydrateAndRefresh,
  createProject,
  renameProject,
  togglePin,
  toggleArchive,
  deleteProject,
} = useProjects()

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch('/api/v1/projects')

  prime(response)
}

interface ProjectNameModalInstance {
  openCreate: () => void
  openRename: (project: Project) => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const projectNameModalRef = shallowRef<ProjectNameModalInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const isProjectModalSubmitting = shallowRef<boolean>(false)

onMounted(() => {
  hydrateAndRefresh()
  document.addEventListener('keydown', onSearchKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onSearchKeydown)
})

function openProject(projectId: string) {
  navigateTo(`/chats/projects/${projectId}`)
}

function onProjectCardClick(event: MouseEvent, projectId: string) {
  const target = event.target as HTMLElement | null

  if (target?.closest('.js-project-actions-dropdown')) {
    return
  }

  openProject(projectId)
}

function openCreateModal() {
  projectNameModalRef.value?.openCreate()
}

function openRenameModal(project: Project) {
  projectNameModalRef.value?.openRename(project)
}

async function onProjectModalSubmit(payload: {
  mode: 'create' | 'rename'
  projectId?: string
  name: string
}) {
  isProjectModalSubmitting.value = true

  try {
    if (payload.mode === 'create') {
      const project = await createProject(payload.name)

      if (project) {
        projectNameModalRef.value?.close()
      }

      return
    }

    if (!payload.projectId) {
      return
    }

    await renameProject(payload.projectId, payload.name)
    projectNameModalRef.value?.close()
  } finally {
    isProjectModalSubmitting.value = false
  }
}

async function onDeleteProject(projectId: string) {
  const result = await useConfirm({
    text: 'Delete this project? Chats inside will not be deleted.',
    alert: true,
    actions: ['Delete'],
  })

  if (!result) return

  await deleteProject(projectId)
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  const tagName = element?.tagName
  const isEditable = element?.hasAttribute?.('contenteditable')

  return (
    (tagName === 'INPUT'
      && !['radio', 'checkbox'].includes(
        (element as HTMLInputElement).type,
      ))
      || tagName === 'TEXTAREA'
      || isEditable
  )
}

function onSearchKeydown(event: KeyboardEvent) {
  if (document.querySelector('dialog[open]')) {
    return
  }

  if (event.key === '/') {
    if (isEditableTarget(event.target)) {
      return
    }

    event.preventDefault()
    searchInputRef.value?.inputRef?.focus()

    return
  }

  if (event.key === 'Escape' && search.value) {
    search.value = ''
  }
}
</script>
