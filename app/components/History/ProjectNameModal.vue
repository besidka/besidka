<template>
  <Teleport to="body">
    <dialog
      ref="modalRef"
      class="modal modal-bottom sm:modal-middle"
    >
      <div
        class="modal-box max-sm:max-h-[calc(var(--visual-viewport-height,100svh)-var(--spacing)_*_4)] overflow-y-auto"
      >
        <h3 class="font-bold text-lg mb-2">
          {{ mode === 'create' ? 'Create project' : 'Rename project' }}
        </h3>
        <p class="text-sm opacity-60 mb-4">
          {{ mode === 'create'
            ? 'Organize related conversations together.'
            : 'Choose a new name for this project.' }}
        </p>
        <input
          ref="inputRef"
          v-model="nameValue"
          type="text"
          class="input input-bordered w-full"
          placeholder="Enter project name"
          maxlength="100"
          @keydown.enter="onSubmit"
        >
        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost">Cancel</button>
          </form>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!nameValue.trim() || isSubmitLocked"
            @click="onSubmit"
          >
            <span
              v-if="isSubmitLocked"
              class="loading loading-spinner loading-xs"
            />
            <span v-else>
              {{ mode === 'create' ? 'Create' : 'Save' }}
            </span>
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { Project } from '#shared/types/projects.d'

const props = withDefaults(defineProps<{
  isSubmitting?: boolean
}>(), {
  isSubmitting: false,
})

const emit = defineEmits<{
  submit: [payload: {
    mode: 'create' | 'rename'
    projectId?: string
    name: string
  }]
}>()

const modalRef = shallowRef<HTMLDialogElement | null>(null)
const inputRef = shallowRef<HTMLInputElement | null>(null)
const mode = shallowRef<'create' | 'rename'>('create')
const projectId = shallowRef<string | undefined>(undefined)
const nameValue = shallowRef<string>('')
const isSubmitPending = shallowRef<boolean>(false)
const isSubmitLocked = computed(() => {
  return isSubmitPending.value || props.isSubmitting
})

async function openCreate() {
  mode.value = 'create'
  projectId.value = undefined
  nameValue.value = ''

  await openDialogWithFocus(modalRef.value, inputRef.value)
}

async function openRename(project: Project) {
  mode.value = 'rename'
  projectId.value = project.id
  nameValue.value = project.name

  await openDialogWithFocus(modalRef.value, inputRef.value, {
    selectText: true,
  })
}

function close() {
  modalRef.value?.close()
  mode.value = 'create'
  projectId.value = undefined
  nameValue.value = ''
  isSubmitPending.value = false
}

async function onSubmit() {
  const name = nameValue.value.trim()

  if (!name || isSubmitLocked.value) {
    return
  }

  isSubmitPending.value = true

  emit('submit', {
    mode: mode.value,
    ...(projectId.value ? { projectId: projectId.value } : {}),
    name,
  })

  await nextTick()

  if (!props.isSubmitting) {
    isSubmitPending.value = false
  }
}

defineExpose({
  openCreate,
  openRename,
  close,
})
</script>
