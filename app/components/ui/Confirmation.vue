<template>
  <dialog
    ref="modal"
    class="modal modal-bottom sm:modal-middle"
    @cancel.prevent="decline"
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
        v-if="confirmation?.subtitle"
        class="pt-4 text-sm text-base-content/70"
      >
        {{ confirmation.subtitle }}
      </p>
      <p
        v-else-if="confirmation?.alert"
        class="py-4"
      >
        Be careful, this action cannot be undone.
        It could affect other parts of the system that depends on it.
      </p>
      <div class="modal-action">
        <button
          type="button"
          data-testid="confirmation-decline"
          class="btn btn-error btn-ghost btn-sm"
          @click="decline"
        >
          {{ confirmation ? labelDecline : 'Close' }}
        </button>
        <button
          v-if="confirmation && actions.length === 1"
          type="button"
          data-testid="confirmation-action-0"
          class="btn btn-primary btn-sm"
          @click="confirmAt(0)"
        >
          {{ actions[0] }}
        </button>
        <div
          v-else-if="confirmation && actions.length > 1"
          data-testid="confirmation-actions-split"
          class="join"
        >
          <button
            type="button"
            data-testid="confirmation-action-0"
            class="btn light:btn-primary dark:btn-secondary btn-sm join-item"
            @click="confirmAt(0)"
          >
            {{ actions[0] }}
          </button>
          <details class="dropdown dropdown-top dropdown-end join-item">
            <summary class="btn light:btn-primary dark:btn-secondary btn-sm join-item px-2">
              <Icon name="lucide:chevron-up" size="14" />
            </summary>
            <div class="dropdown-content z-50 w-32 pb-2">
              <ul class="grid gap-2 w-full bg-base-100 rounded-box w-full shadow-sm">
                <li
                  v-for="(action, index) in actions.slice(1)"
                  :key="index"
                >
                  <button
                    type="button"
                    :data-testid="`confirmation-action-${index + 1}`"
                    class="btn light:btn-primary dark:btn-secondary btn-sm btn-block"
                    @click="confirmAt(index + 1)"
                  >
                    {{ action }}
                  </button>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </div>
    <button
      type="button"
      class="modal-backdrop"
      aria-label="Close"
      @click="decline"
    />
  </dialog>
</template>

<script setup lang="ts">
interface Props {
  labelDecline?: string
}

const props = withDefaults(defineProps<Props>(), {
  labelDecline: 'Decline',
})

const confirmation = useConfirmation()

const actions = computed(() => confirmation.value?.actions ?? [])

const labelDecline = computed<string>(() => {
  return confirmation.value?.labelDecline ?? props.labelDecline
})

const modal = useTemplateRef<HTMLDialogElement>('modal')

watch(confirmation, () => {
  if (!modal.value) return

  confirmation.value
    ? modal.value.showModal()
    : modal.value.close()
})

function confirmAt(index: number) {
  const label = actions.value[index]!

  resolveConfirmation({ label, index })
}

function decline() {
  resolveConfirmation(null)
}
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
