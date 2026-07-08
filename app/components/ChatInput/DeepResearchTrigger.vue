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
      data-testid="deep-research-trigger"
      class="btn btn-xs btn-accent btn-ghost btn-ghost-legacy rounded-full"
      :class="{
        'btn-active': isResearchActive || isDropdownHovered,
        'pl-[5px]': isResearchActive,
        'btn-circle': !isResearchActive,
        'btn-disabled': disabled,
      }"
      aria-label="Set deep research level"
      :title="isResearchActive
        ? `Deep research: ${activeLabel}`
        : 'Deep research'
      "
    >
      <Icon name="lucide:telescope" size="16" class="text-current" />
      <span v-if="isResearchActive">
        {{ activeLabel }}
      </span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-52 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <ChatInputDeepResearchMenuItems
              :research-level="researchLevel"
              :capability="capability"
              @select-research-level="selectLevel"
            />
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
import type {
  ProviderResearchCapability,
  ResearchLevelSetting,
} from '#shared/types/research.d'

const props = defineProps<{
  isWebSearchEnabled?: boolean
  capability: ProviderResearchCapability | null
  disabled?: boolean
}>()

const researchLevel = defineModel<ResearchLevelSetting>('researchLevel', {
  default: 'off',
})

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isResearchActive = computed<boolean>(() => {
  return isDeepResearchActive(researchLevel.value)
})

const activeLabel = computed<string>(() => {
  if (!isDeepResearchActive(researchLevel.value)) {
    return ''
  }

  return props.capability?.levels[researchLevel.value]?.label
    ?? researchLevel.value
})

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid || props.disabled) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function selectLevel(level: ResearchLevelSetting) {
  if (props.disabled) {
    return
  }

  researchLevel.value = level
}
</script>
