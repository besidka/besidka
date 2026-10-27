<template>
  <label
    ref="row"
    class="flex items-center gap-2.5 w-full min-h-9 max-md:min-h-11 px-2 py-1 rounded-box text-sm"
    :class="disabled
      ? 'cursor-not-allowed'
      : 'cursor-pointer hover:bg-base-200'"
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
const { isGuarded } = useRevealGuard()

const describedBy = computed<string | undefined>(() => {
  const ids = [
    props.hint ? hintId : undefined,
    props.extraDescribedBy,
  ].filter(Boolean)

  return ids.length ? ids.join(' ') : undefined
})

function isFocusLost(): boolean {
  const activeElement = document.activeElement

  return !activeElement
    || !activeElement.isConnected
    || activeElement === document.body
    || activeElement instanceof HTMLDialogElement
}

/**
 * A row that unmounts while it holds focus drops focus to the document body.
 * The checked radio of the level group is the nearest stable control, so
 * keyboard users keep their place in the menu.
 */
async function restoreFocus(content: Element) {
  await nextTick()

  if (!content.isConnected || !isFocusLost()) {
    return
  }

  const target = content.querySelector<HTMLInputElement>(
    '.js-reasoning-level-group input:checked:not(:disabled)',
  ) ?? content.querySelector<HTMLInputElement>(
    'input[type="radio"]:checked:not(:disabled)',
  )

  target?.focus({ preventScroll: true })
}

onBeforeUnmount(() => {
  const element = row.value
  const content = element?.closest('.js-tools-content')

  if (!element || !content || !element.contains(document.activeElement)) {
    return
  }

  restoreFocus(content)
})

function onClick(event: MouseEvent) {
  if (isGuarded.value) {
    event.preventDefault()
  }
}

function onChange(event: Event) {
  const input = event.target as HTMLInputElement

  if (isGuarded.value) {
    input.checked = props.modelValue

    return
  }

  emit('update:modelValue', input.checked)
}
</script>
