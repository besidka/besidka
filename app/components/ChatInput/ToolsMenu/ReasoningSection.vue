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
        class="js-reasoning-level-group"
        :name="`${groupId}-level`"
        :legend="isToggleMode ? 'Reasoning' : 'Reasoning effort'"
        :options="levelSegments"
        :model-value="reasoning"
        @update:model-value="onSelectLevel"
      />
    </div>
    <div class="px-2 pb-1.5">
      <p
        class="min-h-4 text-xs leading-4 text-base-content/60"
        data-testid="reasoning-default-caption"
      >
        <template v-if="isSavedAsDefault">
          {{ defaultLabel }} is your default
        </template>
        <template v-else>
          Your default is {{ defaultLabel }} &middot;
          <ChatInputToolsMenuInlineButton
            :is-pending="isSavePending"
            data-testid="reasoning-save-default-button"
            @click="onSaveDefault"
          >
            {{ isSavePending ? 'Saving…' : `Save ${levelLabel} as default` }}
          </ChatInputToolsMenuInlineButton>
        </template>
      </p>
    </div>
    <ChatInputToolsMenuReveal :is-open="reasoning !== 'off'">
      <ChatInputToolsMenuToggleRow
        label="Show steps expanded"
        icon="lucide:list-tree"
        test-id="reasoning-expanded-toggle"
        :model-value="reasoningExpanded"
        @update:model-value="setReasoningExpanded"
      />
    </ChatInputToolsMenuReveal>
    <ChatInputToolsMenuReveal :is-open="isAutoHideAvailable">
      <ChatInputToolsMenuToggleRow
        label="Auto-hide when done"
        icon="lucide:timer-reset"
        test-id="reasoning-auto-hide-toggle"
        :model-value="reasoningAutoHide"
        @update:model-value="setReasoningAutoHide"
      />
    </ChatInputToolsMenuReveal>
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
      iconComponent: getThinkIconComponent(level),
      testId: `reasoning-level-${level}`,
    }
  })
})

function getThinkIconComponent(level: ReasoningLevel): string {
  return `SvgoThink${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

const isSavedAsDefault = computed<boolean>(() => {
  return props.reasoning === props.defaultLevel
})

const isSavePending = shallowRef<boolean>(false)

watch(() => [props.reasoning, props.defaultLevel], () => {
  isSavePending.value = false
})

const defaultLabel = computed<string>(() => {
  return getReasoningLevelLabel(props.defaultLevel, isToggleMode.value)
})

const levelLabel = computed<string>(() => {
  return getReasoningLevelLabel(props.reasoning, isToggleMode.value)
})

function onSelectLevel(level: ReasoningLevel) {
  if (level === props.reasoning) {
    return
  }

  emit('select-level', level)
}

function onSaveDefault() {
  if (isSavedAsDefault.value || isSavePending.value) {
    return
  }

  isSavePending.value = true
  emit('save-default', props.reasoning)
}
</script>
