<template>
  <UiBubble
    class="mb-4 !block"
    :class="{
      'opacity-70 pointer-events-none': isLoading,
    }"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          Project instructions
        </h2>
        <p class="mt-1 text-sm opacity-70">
          These instructions apply to future messages in chats assigned to this
          project.
        </p>
      </div>
      <div
        v-if="hasInstructions"
        class="badge badge-ghost badge-sm shrink-0"
      >
        Active
      </div>
    </div>

    <textarea
      ref="textarea"
      v-model="input"
      class="
        textarea textarea-bordered mt-4 min-h-36 w-full resize-none
        max-h-[min(300px,33dvh)] overflow-y-auto
      "
      placeholder="Example: Always answer as a senior TypeScript engineer.
Keep replies concise and production-focused."
    />

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs opacity-60">
        Leave empty to disable project-specific instructions.
      </p>
      <button
        type="button"
        data-testid="save-project-instructions"
        class="btn btn-primary btn-sm"
        :disabled="!isDirty || isSaving"
        @click="emit('save')"
      >
        <span
          v-if="isSaving"
          class="loading loading-spinner loading-xs"
        />
        <span v-else>
          Save instructions
        </span>
      </button>
    </div>
  </UiBubble>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  isLoading: boolean
  isSaving: boolean
  hasInstructions: boolean
  isDirty: boolean
}>()

const emit = defineEmits<{
  'save': []
  'update:modelValue': [value: string]
}>()

const { textarea, input } = useTextareaAutosize({
  input: shallowRef(props.modelValue),
})

watch(() => props.modelValue, (value) => {
  if (input.value === value) {
    return
  }

  input.value = value
}, { immediate: true })

watch(input, (value) => {
  if (value === props.modelValue) {
    return
  }

  emit('update:modelValue', value)
})
</script>
