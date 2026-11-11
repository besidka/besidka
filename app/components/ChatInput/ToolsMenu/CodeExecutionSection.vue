<template>
  <ChatInputToolsMenuSection
    id="code"
    :label="CODE_EXECUTION_TOOL_LABEL"
    :is-highlighted="isHighlighted"
  >
    <ChatInputToolsMenuToggleRow
      :label="CODE_EXECUTION_TOOL_LABEL"
      :icon="CODE_EXECUTION_TOOL_ICON"
      hint="For the next message only"
      :aria-label="CODE_EXECUTION_TOOL_LABEL"
      test-id="tools-code-execution-toggle"
      :model-value="isEnabled || isConfirming"
      :extra-described-by="isNoteVisible ? noteId : undefined"
      @update:model-value="onToggle"
    >
      <template #label-extra>
        <button
          type="button"
          class="inline-grid place-items-center size-5 rounded-full text-base-content/60 hover:text-accent cursor-pointer"
          aria-label="How Run code is billed"
          :aria-expanded="isNoteVisible"
          :aria-controls="noteId"
          data-testid="code-execution-info"
          @click.prevent="isNoteOpen = !isNoteOpen"
        >
          <Icon
            name="lucide:info"
            size="14"
          />
        </button>
      </template>
    </ChatInputToolsMenuToggleRow>
    <ChatInputToolsMenuReveal :is-open="isNoteVisible">
      <ChatInputToolsMenuInfoNote
        :id="noteId"
        class="mx-2 mt-1 mb-2 ml-8.5"
        data-testid="code-execution-note"
      >
        {{ noteText }}
      </ChatInputToolsMenuInfoNote>
    </ChatInputToolsMenuReveal>
    <ChatInputToolsMenuReveal :is-open="isConfirming">
      <div
        role="group"
        aria-label="Confirm Run code"
        class="flex flex-wrap items-center gap-2 px-2 pb-2 ml-8.5"
        data-testid="code-execution-confirm"
      >
        <button
          ref="confirmButton"
          type="button"
          class="btn btn-sm btn-accent"
          data-testid="code-execution-confirm-accept"
          @click="onConfirm"
        >
          Turn on
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-ghost-legacy"
          data-testid="code-execution-confirm-cancel"
          @click="onCancel"
        >
          Not now
        </button>
      </div>
    </ChatInputToolsMenuReveal>
  </ChatInputToolsMenuSection>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  isEnabled: boolean
  providerId?: string | null
  isHighlighted?: boolean
}>(), {
  providerId: null,
  isHighlighted: false,
})

const emit = defineEmits<{
  toggle: [isOn: boolean]
}>()

const noteId = useId()
const runtimeConfigPublic = useRuntimeConfig().public
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton')
const isNoteOpen = shallowRef<boolean>(false)
const isConfirming = shallowRef<boolean>(false)

const isNoteVisible = computed<boolean>(() => {
  return isNoteOpen.value || isConfirming.value
})

const noteText = computed<string>(() => {
  return getCodeExecutionNote(props.providerId, runtimeConfigPublic)
})

watch(() => props.providerId, () => {
  isConfirming.value = false
})

async function onToggle(isOn: boolean) {
  if (!isOn) {
    isConfirming.value = false
    emit('toggle', false)

    return
  }

  if (!props.providerId || readCodeExecutionConfirmed(props.providerId)) {
    emit('toggle', true)

    return
  }

  isConfirming.value = true

  await nextTick()

  confirmButton.value?.focus({ preventScroll: true })
}

function onConfirm() {
  if (props.providerId) {
    writeCodeExecutionConfirmed(props.providerId)
  }

  isConfirming.value = false
  emit('toggle', true)
}

function onCancel() {
  isConfirming.value = false
}
</script>
