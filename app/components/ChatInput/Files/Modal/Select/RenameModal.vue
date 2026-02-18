<template>
  <Teleport to="body">
    <dialog
      ref="renameModalRef"
      class="modal modal-bottom sm:modal-middle"
    >
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Rename file</h3>
        <input
          ref="renameInputRef"
          v-model="renameValue"
          type="text"
          class="input input-bordered w-full"
          placeholder="Enter new name"
          @keydown.enter="onSubmit"
        >
        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost">Cancel</button>
          </form>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!renameValue.trim() || isRenaming"
            @click="onSubmit"
          >
            <span
              v-if="isRenaming"
              class="loading loading-spinner loading-xs"
            />
            <span v-else>Rename</span>
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
import type { FileManagerFile } from '~/types/file-manager'

const emit = defineEmits<{
  submit: [fileId: string, newName: string]
}>()

const renameModalRef = shallowRef<HTMLDialogElement | null>(null)
const renameInputRef = shallowRef<HTMLInputElement | null>(null)
const renameFileId = shallowRef<string | null>(null)
const renameValue = shallowRef<string>('')
const isRenaming = shallowRef<boolean>(false)

async function open(file: FileManagerFile) {
  renameFileId.value = file.id
  renameValue.value = file.name
  renameModalRef.value?.showModal()

  await nextTick()

  const input = renameInputRef.value
  if (input) {
    input.focus()
    input.select()
  }
}

function close() {
  renameModalRef.value?.close()
  renameFileId.value = null
  renameValue.value = ''
  isRenaming.value = false
}

async function onSubmit() {
  if (!renameValue.value.trim() || !renameFileId.value || isRenaming.value) {
    return
  }

  isRenaming.value = true

  emit('submit', renameFileId.value, renameValue.value.trim())
}

defineExpose({
  open,
  close,
})
</script>
