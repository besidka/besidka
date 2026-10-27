<template>
  <label
    ref="row"
    class="flex items-center gap-2.5 w-full min-h-9 max-md:min-h-11 px-2 py-1 rounded-box text-sm"
    :class="disabled
      ? 'cursor-not-allowed'
      : 'cursor-pointer hover:bg-base-200'"
    @pointerdown="onPointerDown"
    @keydown="onKeyDown"
  >
    <slot name="icon">
      <Icon
        v-if="icon"
        :name="icon"
        size="16"
        class="shrink-0"
        :class="disabled ? 'opacity-40' : 'opacity-75'"
      />
      <span
        v-else
        class="w-4 shrink-0"
      />
    </slot>
    <span class="flex flex-col grow min-w-0">
      <span class="inline-flex items-center gap-1 leading-tight">
        <span :class="{ 'opacity-50': disabled }">{{ label }}</span>
        <slot name="label-extra" />
      </span>
      <span
        v-if="hint"
        :id="hintId"
        class="text-xs leading-tight text-base-content/60"
        :data-testid="hintTestId"
      >
        {{ hint }}
      </span>
    </span>
    <input
      type="checkbox"
      role="switch"
      class="toggle toggle-sm toggle-accent shrink-0"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-describedby="describedBy"
      :data-testid="testId"
      @click="onClick"
      @change="onChange"
    >
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  modelValue: boolean
  icon?: string
  hint?: string
  disabled?: boolean
  ariaLabel?: string
  testId?: string
  hintTestId?: string
  extraDescribedBy?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const row = useTemplateRef<HTMLLabelElement>('row')
const hintId = useId()
const {
  onPointerDown,
  onKeyDown,
  shouldIgnoreActivation,
} = useRevealGuard()

useToolsMenuFocusRescue(row)

const describedBy = computed<string | undefined>(() => {
  const ids = [
    props.hint ? hintId : undefined,
    props.extraDescribedBy,
  ].filter(Boolean)

  return ids.length ? ids.join(' ') : undefined
})

function onClick(event: MouseEvent) {
  if (shouldIgnoreActivation(event)) {
    event.preventDefault()
  }
}

function onChange(event: Event) {
  const input = event.target as HTMLInputElement

  if (shouldIgnoreActivation()) {
    input.checked = props.modelValue

    return
  }

  emit('update:modelValue', input.checked)
}
</script>
