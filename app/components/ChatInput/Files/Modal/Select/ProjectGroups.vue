<template>
  <div
    ref="containerRef"
    class="js-project-groups flex flex-col gap-1"
    data-testid="files-project-groups"
  >
    <details
      v-for="group in groups"
      :key="group.id"
      class="js-project-group group/project-group collapse"
      :open="group.isOpen"
      :data-project-group-id="group.id"
      data-testid="files-project-group"
    >
      <summary
        class="
          collapse-title flex min-h-11 items-center gap-2 rounded-box
          px-2 py-0 text-sm font-medium hover:bg-base-200
        "
        :aria-expanded="group.isOpen"
        data-testid="files-project-group-toggle"
        @click.prevent="emit('toggle', group.id)"
      >
        <Icon
          name="lucide:chevron-right"
          class="
            size-4 shrink-0 text-base-content/60 transition-transform
            group-open/project-group:rotate-90
          "
        />
        <Icon
          :name="group.isOpen ? 'lucide:folder-open' : 'lucide:folder'"
          size="16"
          class="shrink-0 text-base-content/60"
        />
        <span class="min-w-0 grow truncate">
          {{ group.name }}
        </span>
        <Icon
          v-if="group.pinned"
          name="lucide:pin"
          size="12"
          class="shrink-0 text-base-content/60"
          aria-label="Pinned"
        />
        <span
          v-if="group.archived"
          class="badge badge-ghost badge-sm shrink-0"
        >
          Archived
        </span>
        <span
          class="badge badge-sm shrink-0 tabular-nums"
          data-testid="files-project-group-count"
        >
          {{ getCountLabel(group) }}
        </span>
      </summary>

      <div
        v-if="group.isOpen"
        class="collapse-content px-0 pb-1"
      >
        <template v-if="!group.hasLoaded && !group.hasError">
          <LazyChatInputFilesModalSelectGridSkeleton
            v-if="viewMode === 'grid'"
          />
          <LazyChatInputFilesModalSelectListSkeleton v-else />
        </template>

        <template v-else-if="group.hasLoaded">
          <LazyChatInputFilesModalSelectGridView
            v-if="viewMode === 'grid'"
            :files="group.files"
            :selected-ids="selectedIds"
            :is-touch-selecting="isTouchSelecting && touchGroupId === group.id"
            :touched-indices="getTouchedIndices(group.id)"
            @file-click="(
              event: MouseEvent,
              file: FileManagerFile,
              index: number,
            ) => emit('file-click', event, file, index, group.id)"
            @rename="emit('rename', $event)"
            @delete="emit('delete', $event)"
          />
          <LazyChatInputFilesModalSelectListView
            v-else
            :files="group.files"
            :selected-ids="selectedIds"
            :is-touch-selecting="isTouchSelecting && touchGroupId === group.id"
            :touched-indices="getTouchedIndices(group.id)"
            :all-selected="isGroupAllSelected(group)"
            :has-selection="hasGroupSelection(group)"
            @file-click="(
              event: MouseEvent,
              file: FileManagerFile,
              index: number,
            ) => emit('file-click', event, file, index, group.id)"
            @rename="emit('rename', $event)"
            @delete="emit('delete', $event)"
            @toggle-select-all="emit('toggle-select-all', group.id)"
          />

          <div
            v-if="hasMoreFiles(group)"
            class="flex flex-col items-center gap-1 mt-3"
          >
            <span class="text-xs text-base-content/60">
              {{ group.files.length }} / {{ group.total }}
            </span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="group.isLoading"
              data-testid="files-project-group-load-more"
              @click="emit('load-more', group.id)"
            >
              <span
                v-if="group.isLoading"
                class="loading loading-spinner loading-xs"
              />
              <span v-else>Load more</span>
            </button>
          </div>
        </template>

        <div
          v-else
          class="flex justify-center py-3"
        >
          <button
            type="button"
            class="btn btn-sm"
            data-testid="files-project-group-retry"
            @click="emit('load-more', group.id)"
          >
            Try again
          </button>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type {
  FileManagerFile,
  ProjectFileGroup,
  ViewMode,
} from '~/types/file-manager'

const props = defineProps<{
  groups: ProjectFileGroup[]
  selectedIds: Set<string>
  viewMode: ViewMode
  isTouchSelecting: boolean
  touchedIndices: Set<number>
  touchGroupId: string | null
}>()

const emit = defineEmits<{
  'toggle': [groupId: string]
  'load-more': [groupId: string]
  'file-click': [
    event: MouseEvent,
    file: FileManagerFile,
    index: number,
    groupId: string,
  ]
  'rename': [file: FileManagerFile]
  'delete': [file: FileManagerFile]
  'toggle-select-all': [groupId: string]
}>()

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const noTouchedIndices = new Set<number>()

function getCountLabel(group: ProjectFileGroup): string {
  if (!group.hasLoaded) {
    return String(group.fileCount)
  }

  return `${group.files.length}/${group.total}`
}

function hasMoreFiles(group: ProjectFileGroup): boolean {
  return group.serverOffset < group.total
}

function getTouchedIndices(groupId: string): Set<number> {
  return props.touchGroupId === groupId
    ? props.touchedIndices
    : noTouchedIndices
}

function isGroupAllSelected(group: ProjectFileGroup): boolean {
  return group.files.length > 0 && group.files.every((file) => {
    return props.selectedIds.has(file.id)
  })
}

function hasGroupSelection(group: ProjectFileGroup): boolean {
  return group.files.some(file => props.selectedIds.has(file.id))
}

defineExpose({
  containerRef,
})
</script>
