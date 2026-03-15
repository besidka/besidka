<template>
  <Transition
    enter-active-class="transition-all duration-200"
    leave-active-class="transition-all duration-50"
    enter-from-class="opacity-0 translate-y-4"
    leave-to-class="opacity-0 translate-y-4"
  >
    <div
      v-if="visible"
      class="sticky top-4 z-10 shrink-0 flex flex-wrap items-center justify-between gap-3 p-3 bg-base-200 rounded-box sticky:shadow-md"
    >
      <div class="grid grid-cols-2 max-sm:w-full sm:flex sm:grow gap-3 items-center">
        <span class="sm:grow text-sm max-sm:text-center">
          Selected: <strong>{{ selectedCount }}</strong>
        </span>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          @click="onDeselect"
        >
          <Icon name="lucide:x" size="12" />
          Deselect
        </button>
      </div>
      <div class="grid grid-cols-2 max-sm:w-full sm:flex gap-3">
        <button
          type="button"
          class="btn btn-sm btn-ghost max-sm:btn-block"
          @click="onMoveToProject"
        >
          <Icon name="lucide:folder" size="14" />
          Move to project
        </button>
        <button
          type="button"
          class="btn btn-sm btn-error btn-outline max-sm:btn-block"
          :disabled="isDeleting"
          :title="isDeleting ? 'Deleting' : 'Delete'"
          @click="onDelete"
        >
          <span
            v-if="isDeleting"
            class="loading loading-spinner loading-xs"
          />
          <Icon v-else name="lucide:trash-2" size="14" />
          {{ isDeleting ? 'Deleting' : 'Delete' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  selectedCount: number
  visible: boolean
  isDeleting: boolean
}>()

const emit = defineEmits<{
  deselect: []
  delete: []
  moveToProject: []
}>()

function onDeselect() {
  emit('deselect')
}

function onDelete() {
  emit('delete')
}

function onMoveToProject() {
  emit('moveToProject')
}
</script>
