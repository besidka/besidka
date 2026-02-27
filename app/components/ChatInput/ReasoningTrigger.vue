<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top dropdown-end"
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
            <li class="menu-title text-xs pt-2">
              Reasoning steps
            </li>
            <li class="">
              <fieldset class="fieldset p-0">
                <label
                  class="label cursor-pointer py-1 px-2 justify-between gap-2"
                >
                  <span
                    class="flex items-center gap-2"
                    :class="{
                      'text-primary dark:text-primary-content':
                        reasoningExpanded
                    }"
                  >
                    <Icon
                      :name="`lucide:eye${reasoningExpanded ? '' : '-off'}`"
                      size="16"
                    />
                    <span class="label-text text-xs">
                      {{ reasoningExpanded ? 'Visible' : 'Hidden' }}
                    </span>
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
                @click="selectLevel(level)"
              >
                <component
                  :is="getIconComponent(level)"
                  class="size-4 text-current"
                />
                <span class="capitalize">{{ level }}</span>
              </button>
            </li>
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
}>()

const reasoning = defineModel<ReasoningLevel>('reasoning', {
  default: 'off',
})

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)
const { reasoningExpanded, setReasoningExpanded } = useUserSetting()

const isReasoningActive = computed<boolean>(() => {
  return reasoning.value !== 'off'
})

const levelsForMenu = computed<ReasoningLevel[]>(() => {
  return ['off', ...props.levels]
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

  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
}

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
</script>
