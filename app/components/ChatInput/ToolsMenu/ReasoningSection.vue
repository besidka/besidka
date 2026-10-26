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
    <Transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
    >
      <ChatInputToolsMenuToggleRow
        v-if="isSaveDefaultRowVisible"
        label="Save as default"
        icon="lucide:bookmark"
        :hint="saveDefaultHint"
        test-id="reasoning-save-default-toggle"
        :model-value="isSavedAsDefault"
        :disabled="isSavedAsDefault"
        @update:model-value="onSaveDefault"
      />
    </Transition>
    <ChatInputToolsMenuToggleRow
      label="Show steps expanded"
      icon="lucide:list-tree"
      test-id="reasoning-expanded-toggle"
      :model-value="reasoningExpanded"
      :disabled="reasoning === 'off'"
      @update:model-value="setReasoningExpanded"
    />
    <ChatInputToolsMenuToggleRow
      label="Auto-hide when done"
      icon="lucide:timer-reset"
      test-id="reasoning-auto-hide-toggle"
      :model-value="reasoningAutoHide"
      :disabled="reasoning === 'off' || !reasoningExpanded"
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
const savedLevel = shallowRef<ReasoningLevel | null>(null)

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

const isSaveDefaultRowVisible = computed<boolean>(() => {
  return !isSavedAsDefault.value || savedLevel.value === props.reasoning
})

const saveDefaultHint = computed<string>(() => {
  if (isSavedAsDefault.value) {
    return 'Saved as your default'
  }

  const defaultLabel = getReasoningLevelLabel(
    props.defaultLevel,
    isToggleMode.value,
  )

  return `Your default is ${defaultLabel}`
})

watch(() => props.reasoning, (level) => {
  if (savedLevel.value !== level) {
    savedLevel.value = null
  }
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

  savedLevel.value = props.reasoning
  emit('save-default', props.reasoning)
}
</script>
