<template>
  <TransitionGroup name="slide-fade">
    <template v-if="reasoning !== 'off'">
      <li class="menu-title text-xs pt-2">
        Reasoning steps
      </li>
      <Transition name="slide-fade">
        <li v-if="reasoningExpanded">
          <fieldset class="fieldset p-0">
            <label
              data-tip="Once reasoning done"
              class="tooltip tooltip-top label cursor-pointer py-1 px-2 justify-between gap-2 text-primary dark:text-primary-content"
            >
              <span class="flex items-center gap-2">
                <Icon name="lucide:timer-reset" size="16" />
                <span class="label-text text-xs text-primary dark:text-primary-content">
                  Auto-hide
                </span>
              </span>
              <input
                data-testid="reasoning-auto-hide-toggle"
                type="checkbox"
                class="toggle toggle-xs"
                :checked="reasoningAutoHide"
                @change="onReasoningAutoHideChange"
              >
            </label>
          </fieldset>
        </li>
      </Transition>
      <li>
        <fieldset class="fieldset p-0">
          <label
            class="label cursor-pointer py-1 px-2 justify-between gap-2 text-primary dark:text-primary-content"
          >
            <span
              class="flex items-center gap-2"
              :class="{
                'text-primary dark:text-primary-content': reasoningExpanded,
              }"
            >
              <Icon name="lucide:list-tree" size="16" />
              <span class="label-text text-xs">Expanded</span>
            </span>
            <input
              data-testid="reasoning-expanded-toggle"
              type="checkbox"
              class="toggle toggle-xs"
              :checked="reasoningExpanded"
              @change="onReasoningExpandedChange"
            >
          </label>
        </fieldset>
      </li>
    </template>
  </TransitionGroup>
  <li class="menu-title text-xs">
    Reasoning effort
  </li>
  <li
    v-for="level in levelsForMenu"
    :key="level"
  >
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          reasoning === level,
      }"
      @click="emit('select-level', level)"
    >
      <component
        :is="getIconComponent(level)"
        class="size-4 text-current"
      />
      <span class="capitalize">{{ level }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'

const props = defineProps<{
  reasoning: ReasoningLevel
  levels: ReasoningEnabledLevel[]
}>()

const emit = defineEmits<{
  'select-level': [level: ReasoningLevel]
}>()

const {
  reasoningExpanded,
  reasoningAutoHide,
  setReasoningExpanded,
  setReasoningAutoHide,
} = useUserSetting()

const levelsForMenu = computed<ReasoningLevel[]>(() => {
  return ['off', ...props.levels]
})

function getIconComponent(level: ReasoningLevel): string {
  return `SvgoThink${level.charAt(0).toUpperCase() + level.slice(1)}`
}

function onReasoningExpandedChange(event: Event) {
  const target = event.target as HTMLInputElement | null

  if (!target) {
    return
  }

  void setReasoningExpanded(target.checked)
}

function onReasoningAutoHideChange(event: Event) {
  const target = event.target as HTMLInputElement | null

  if (!target) {
    return
  }

  void setReasoningAutoHide(target.checked)
}
</script>

<style scoped>
.slide-fade-enter-active {
  transition: all 0.1s ease-in;
}

.slide-fade-enter-from {
  transform: translateY(10px);
  opacity: 0;
}
</style>
