<template>
  <Teleport to="body">
    <dialog
      ref="modalRef"
      class="modal modal-middle"
    >
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Rename chat</h3>
        <input
          ref="inputRef"
          v-model="titleValue"
          type="text"
          autocomplete="off"
          class="input input-bordered w-full"
          placeholder="Enter new title"
          maxlength="200"
          @keydown.enter="onSubmit"
        >
        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost">Cancel</button>
          </form>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!titleValue.trim() || isRenaming"
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
import type { HistoryChat } from '#shared/types/history.d'

const emit = defineEmits<{
  submit: [chatId: string, slug: string, title: string]
}>()

const modalRef = shallowRef<HTMLDialogElement | null>(null)
const inputRef = shallowRef<HTMLInputElement | null>(null)
const chatId = shallowRef<string | null>(null)
const chatSlug = shallowRef<string | null>(null)
const titleValue = shallowRef<string>('')
const isRenaming = shallowRef<boolean>(false)

async function open(chat: HistoryChat) {
  chatId.value = chat.id
  chatSlug.value = chat.slug
  titleValue.value = chat.title || ''
  modalRef.value?.showModal()

  await nextTick()

  const input = inputRef.value

  if (input) {
    input.focus()
    input.select()
  }
}

function close() {
  modalRef.value?.close()
  chatId.value = null
  chatSlug.value = null
  titleValue.value = ''
  isRenaming.value = false
}

function onSubmit() {
  const id = chatId.value
  const slug = chatSlug.value
  const title = titleValue.value.trim()

  if (!id || !slug || !title || isRenaming.value) {
    return
  }

  isRenaming.value = true
  emit('submit', id, slug, title)
}

defineExpose({
  open,
  close,
})
</script>
