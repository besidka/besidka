<template>
  <div
    role="radiogroup"
    :aria-label="`Permission for ${label}`"
    class="flex shrink-0 items-center gap-0.5 rounded-field bg-base-200 p-0.5"
    data-testid="tool-permission-control"
  >
    <div
      v-for="(option, index) in options"
      :key="option.mode"
      class="tooltip tooltip-left before:max-w-44 before:text-xs"
      :data-tip="option.hint"
    >
      <button
        ref="buttons"
        type="button"
        role="radio"
        class="btn btn-circle btn-sm"
        :class="[
          option.isChecked
            ? MODE_CHECKED_CLASS[option.mode]
            : 'btn-ghost text-base-content/60',
          { 'opacity-40': !option.isAvailable },
        ]"
        :aria-checked="option.isChecked"
        :aria-label="option.label"
        :aria-disabled="!option.isAvailable || isBusy"
        :tabindex="option.mode === focusMode ? 0 : -1"
        :data-testid="`tool-permission-option-${option.mode}`"
        :data-mode="option.mode"
        @click="choose(option)"
        @keydown="onKeydown($event, index)"
      >
        <Icon
          :name="TOOL_PERMISSION_MODE_ICONS[option.mode]"
          size="16"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import {
  TOOL_PERMISSION_CONTROL_ORDER,
  TOOL_PERMISSION_MODE_HINTS,
  TOOL_PERMISSION_MODE_ICONS,
  TOOL_PERMISSION_MODE_LABELS,
} from '~/utils/tool-permissions'

interface ModeOption {
  mode: ToolPermissionMode
  label: string
  hint: string
  isChecked: boolean
  isAvailable: boolean
}

const MODE_CHECKED_CLASS: Record<ToolPermissionMode, string> = {
  allow: 'btn-soft btn-soft-selected btn-success',
  ask: 'btn-soft btn-soft-selected btn-warning',
  blocked: 'btn-soft btn-soft-selected btn-error',
}

const NEXT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowUp'])

const props = withDefaults(defineProps<{
  label: string
  mode: ToolPermissionMode
  modes: readonly ToolPermissionMode[]
  unavailableHint?: string
  isBusy?: boolean
}>(), {
  unavailableHint: '',
  isBusy: false,
})

const emit = defineEmits<{
  select: [mode: ToolPermissionMode]
}>()

const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')

const options = computed<ModeOption[]>(() => {
  return TOOL_PERMISSION_CONTROL_ORDER.map((mode) => {
    const isAvailable = props.modes.includes(mode)

    return {
      mode,
      label: TOOL_PERMISSION_MODE_LABELS[mode],
      hint: isAvailable || !props.unavailableHint
        ? TOOL_PERMISSION_MODE_HINTS[mode]
        : `${TOOL_PERMISSION_MODE_LABELS[mode]} — ${props.unavailableHint}`,
      isChecked: mode === props.mode,
      isAvailable,
    }
  })
})

const focusMode = computed<ToolPermissionMode>(() => {
  return options.value.some(option => option.isChecked)
    ? props.mode
    : options.value.find(option => option.isAvailable)?.mode ?? 'ask'
})

function choose(option: ModeOption) {
  if (!option.isAvailable || props.isBusy || option.isChecked) {
    return
  }

  emit('select', option.mode)
}

function onKeydown(event: KeyboardEvent, index: number) {
  const step = NEXT_KEYS.has(event.key)
    ? 1
    : PREVIOUS_KEYS.has(event.key) ? -1 : 0

  if (step === 0) {
    return
  }

  event.preventDefault()

  const count = options.value.length
  const nextIndex = (index + step + count) % count

  buttons.value?.[nextIndex]?.focus()
}
</script>
