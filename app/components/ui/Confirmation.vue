<template>
  <dialog
    ref="modal"
    class="modal modal-bottom sm:modal-middle"
  >
    <div class="modal-box">
      <h3
        v-if="confirmation"
        class="text-lg font-bold"
        :class="{
          'text-center': !confirmation.alert,
        }"
      >
        {{ confirmation.text }}
      </h3>
      <p
        v-if="confirmation?.alert"
        class="py-4"
      >
        Be careful, this action cannot be undone.
        It could affect other parts of the system that depends on it.
      </p>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn btn-error btn-outline">
            {{ confirmation ? labelDecline : 'Close' }}
          </button>
        </form>
        <button
          v-if="confirmation"
          type="button"
          class="btn btn-primary"
          @click="confirm"
        >
          {{ labelConfirm }}
        </button>
      </div>
    </div>
    <form
      method="dialog"
      class="modal-backdrop"
    >
      <button>Close</button>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import type { Confirmation } from '~/types/confirmation.d'

interface Props {
  labelDecline?: string
  labelConfirm?: string
}

withDefaults(defineProps<Props>(), {
  labelDecline: 'Decline',
  labelConfirm: 'Confirm',
})

const confirmation = useConfirmation()

const modal = useTemplateRef<HTMLDialogElement>('modal')

watch(confirmation, () => {
  if (!modal.value) return

  confirmation.value
    ? modal.value.showModal()
    : modal.value.close()
})

const decline = () => {
  confirmation.value = null
}

const confirm = () => {
  const { callback, args } = confirmation.value as Confirmation

  confirmation.value = null
  callback && args && callback(...args)
  modal.value?.close()
}

onMounted(() => {
  modal.value?.addEventListener('close', decline)
})

onUnmounted(() => {
  modal.value?.removeEventListener('close', decline)
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.overlay-enter-active,
.overlay-leave-active,
.confirm-enter-active,
.confirm-leave-active {
    @apply transition-all duration-500;
}

.overlay-enter-from,
.overlay-leave-to {
    @apply opacity-0 invisible;
}

.confirm-enter-from,
.confirm-leave-to {
    @apply opacity-0 invisible -translate-y-8;
}
</style>
