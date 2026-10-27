<template>
  <ChatInputToolsMenuToggleRow
    v-if="mode === 'always-on'"
    label="Reasoning"
    hint="Always on for this model"
    :aria-label="REASONING_ALWAYS_ON_TITLE"
    test-id="reasoning-always-on-menu-item"
    :model-value="true"
    disabled
  >
    <template #icon>
      <SvgoThinkMedium class="size-4 shrink-0 opacity-75" />
    </template>
  </ChatInputToolsMenuToggleRow>
  <template v-else>
    <div class="px-2 pt-1 pb-1.5">
      <ChatInputToolsMenuSegmented
        :name="`${groupId}-level`"
        :legend="isToggleMode ? 'Reasoning' : 'Reasoning effort'"
        :options="levelSegments"
        :model-value="reasoning"
        @update:model-value="onSelectLevel"
      />
    </div>
    <ChatInputToolsMenuToggleRow
      label="Save as default"
      icon="lucide:bookmark"
      :hint="saveDefaultHint"
      test-id="reasoning-save-default-toggle"
      :model-value="isSavePending"
      :disabled="isSavedAsDefault"
      @update:model-value="onSaveDefault"
    />
    <ChatInputToolsMenuToggleRow
      label="Show steps expanded"
      icon="lucide:list-tree"
      test-id="reasoning-expanded-toggle"
      :model-value="reasoningExpanded && reasoning !== 'off'"
      :disabled="reasoning === 'off'"
      @update:model-value="setReasoningExpanded"
    />
    <ChatInputToolsMenuToggleRow
      label="Auto-hide when done"
      icon="lucide:timer-reset"
      test-id="reasoning-auto-hide-toggle"
      :model-value="reasoningAutoHide && isAutoHideAvailable"
      :disabled="!isAutoHideAvailable"
      @update:model-value="setReasoningAutoHide"
    />
  </template>
</template>

<script setup lang="ts">
import type {
  ReasoningEnabledLevel,
  ReasoningLevel,
} from '#shared/types/reasoning.d'
import { REASONING_ALWAYS_ON_TITLE } from '#shared/utils/reasoning'
import type { SegmentedOption } from '~/types/chat-input-tools'

const props = withDefaults(defineProps<{
  mode: 'configurable' | 'always-on'
  reasoning: ReasoningLevel
  levels: ReasoningEnabledLevel[]
  defaultLevel: ReasoningLevel
  canDisable?: boolean
}>(), {
  canDisable: true,
})

const emit = defineEmits<{
  'select-level': [level: ReasoningLevel]
  'save-default': [level: ReasoningLevel]
}>()

const {
  reasoningExpanded,
  reasoningAutoHide,
  setReasoningExpanded,
  setReasoningAutoHide,
} = useUserSetting()

const groupId = useId()

const isAutoHideAvailable = computed<boolean>(() => {
  return props.reasoning !== 'off' && reasoningExpanded.value
})

const isToggleMode = computed<boolean>(() => {
  return props.levels.length === 1
})

const levelSegments = computed<SegmentedOption<ReasoningLevel>[]>(() => {
  const levels: ReasoningLevel[] = props.canDisable
    ? ['off', ...props.levels]
    : props.levels

  return levels.map((level) => {
    return {
      value: level,
      label: getReasoningLevelLabel(level, isToggleMode.value),
      testId: `reasoning-level-${level}`,
    }
  })
})

const isSavedAsDefault = computed<boolean>(() => {
  return props.reasoning === props.defaultLevel
})

const isSavePending = shallowRef<boolean>(false)

watch(() => [props.reasoning, props.defaultLevel], () => {
  isSavePending.value = false
})

const saveDefaultHint = computed<string>(() => {
  const defaultLabel = getReasoningLevelLabel(
    props.defaultLevel,
    isToggleMode.value,
  )

  if (isSavedAsDefault.value) {
    return `${defaultLabel} is your default`
  }

  return `Your default is ${defaultLabel}`
})

function onSelectLevel(level: ReasoningLevel) {
  if (level === props.reasoning) {
    return
  }

  emit('select-level', level)
}

function onSaveDefault(isOn: boolean) {
  if (!isOn || isSavedAsDefault.value) {
    return
  }

  isSavePending.value = true
  emit('save-default', props.reasoning)
}
</script>
