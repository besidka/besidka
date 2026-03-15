<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top"
    :class="{
      'dropdown-end': isWebSearchEnabled,
      'max-xs:dropdown-start xs:dropdown-end': !isWebSearchEnabled
    }"
  >
    <summary
      data-testid="reasoning-trigger"
      class="btn btn-xs btn-accent btn-ghost btn-ghost-legacy rounded-full"
      :class="{
        'btn-active': isReasoningActive || isDropdownHovered,
        'pl-[5px]': isReasoningActive,
        'btn-circle': !isReasoningActive,
      }"
      aria-label="Set reasoning level"
      :title="`Reasoning: ${reasoning}`"
    >
      <component
        :is="getIconComponent(reasoning)"
        class="size-4 text-current"
      />
      <span v-if="isReasoningActive" class="capitalize">
        {{ reasoning }}
      </span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-44 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <ChatInputReasoningMenuItems
              :reasoning="reasoning"
              :levels="props.levels"
              @select-level="selectLevel"
            />
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'

const props = defineProps<{
  levels: ReasoningEnabledLevel[]
  isWebSearchEnabled?: boolean
}>()

const reasoning = defineModel<ReasoningLevel>('reasoning', {
  default: 'off',
})

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isReasoningActive = computed<boolean>(() => {
  return reasoning.value !== 'off'
})

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function selectLevel(level: ReasoningLevel) {
  reasoning.value = level
}

function getIconComponent(level: ReasoningLevel): string {
  return `SvgoThink${level.charAt(0).toUpperCase() + level.slice(1)}`
}
</script>
