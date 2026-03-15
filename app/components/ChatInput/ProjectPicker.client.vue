<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="modal modal-bottom sm:modal-middle"
    >
      <div class="modal-box max-w-2xl">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="font-bold text-lg">
              Choose project
            </h3>
            <p class="text-sm opacity-60 mt-1">
              Start the next chat inside a project.
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
          :is-searching="isLoadingProjects"
          placeholder="Search projects..."
          :show-keyboard-hint="false"
          class="mb-4"
        />

        <div class="rounded-box border border-base-200 max-h-80 overflow-y-auto p-2">
          <div
            v-if="isLoadingProjects"
            class="flex items-center justify-center py-8"
          >
            <span class="loading loading-spinner loading-md" />
          </div>

          <template v-else>
            <ul class="menu menu-sm w-full gap-1">
              <li>
                <h4 class="menu-title px-2">Actions</h4>
                <button
                  type="button"
                  :class="{ 'menu-active': !selectedProjectId }"
                  @click="onSelect(null, null)"
                >
                  <Icon
                    :name="selectedProjectId
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
                  type="button"
                  :class="{
                    'menu-active': project.id === selectedProjectId,
                  }"
                  @click="onSelect(project.id, project.name)"
                >
                  <Icon
                    :name="project.id === selectedProjectId
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
                  type="button"
                  :class="{
                    'menu-active': project.id === selectedProjectId,
                  }"
                  @click="onSelect(project.id, project.name)"
                >
                  <Icon
                    :name="project.id === selectedProjectId
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
import type { Project } from '#shared/types/projects.d'

const emit = defineEmits<{
  submit: [payload: {
    projectId: string | null
    projectName: string | null
  }]
}>()

interface ProjectNameModalInstance {
  openCreate: () => void
  close: () => void
}

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const nuxtApp = useNuxtApp()
const dialogRef = shallowRef<HTMLDialogElement | null>(null)
const projectNameModalRef = shallowRef<ProjectNameModalInstance | null>(null)
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const search = shallowRef<string>('')
const allProjects = ref<Project[]>([])
const isLoadingProjects = shallowRef<boolean>(false)
const selectedProjectId = shallowRef<string | null>(null)
const isProjectModalSubmitting = shallowRef<boolean>(false)

const searchedProjects = computed(() => {
  if (!search.value.length) {
    return allProjects.value
  }

  const query = search.value.toLowerCase()

  return allProjects.value.filter((project) => {
    return project.name.toLowerCase().includes(query)
  })
})

const visiblePinnedProjects = computed(() => {
  return searchedProjects.value.filter(project => !!project.pinnedAt)
})

const visibleProjects = computed(() => {
  return searchedProjects.value.filter(project => !project.pinnedAt)
})

const hasVisibleProjects = computed(() => {
  return visiblePinnedProjects.value.length > 0
    || visibleProjects.value.length > 0
})

async function loadProjects() {
  isLoadingProjects.value = true

  try {
    const response = await $fetch('/api/v1/projects')

    allProjects.value = [...response.pinned, ...response.projects]
  } catch (exception) {
    const parsedException = parseError(exception)

    nuxtApp.runWithContext(() => {
      useErrorMessage(
        parsedException.message || 'Failed to load projects',
        parsedException.why,
      )
    })
  } finally {
    isLoadingProjects.value = false
  }
}

async function open(projectId: string | null) {
  selectedProjectId.value = projectId
  search.value = ''
  dialogRef.value?.showModal()
  await loadProjects()
  await nextTick()
  searchInputRef.value?.inputRef?.focus()
}

function close() {
  dialogRef.value?.close()
  search.value = ''
}

function onSelect(projectId: string | null, projectName: string | null) {
  selectedProjectId.value = projectId
  emit('submit', { projectId, projectName })
  close()
}

function openCreateModal() {
  projectNameModalRef.value?.openCreate()
}

async function onProjectModalSubmit(payload: {
  mode: 'create' | 'rename'
  name: string
}) {
  if (payload.mode !== 'create') {
    return
  }

  isProjectModalSubmitting.value = true
  isLoadingProjects.value = true

  try {
    const result = await $fetch('/api/v1/projects', {
      method: 'PUT',
      body: { name: payload.name },
    })

    const project = result as Project

    allProjects.value = [project, ...allProjects.value]
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
    isLoadingProjects.value = false
  }
}

defineExpose({
  open,
  close,
})
</script>
