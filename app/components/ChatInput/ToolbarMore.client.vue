<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top dropdown-end md:hidden"
  >
    <summary
      class="indicator btn btn-sm btn-ghost btn-circle"
      aria-label="More options"
    >
      <span
        v-if="isAnyFeatureActive"
        class="indicator-item badge badge-accent badge-xs"
      />
      <Icon name="lucide:ellipsis-vertical" size="16" />
    </summary>
    <div class="dropdown-content z-50 w-56 pb-2">
      <div class="bg-base-100 rounded-box w-full shadow-sm">
        <ul class="menu menu-xs w-full">
          <li
            v-if="hasAlwaysOnReasoningRow"
            data-testid="reasoning-always-on-menu-item"
          >
            <label class="flex items-center gap-2">
              <SvgoThinkMedium class="size-4 text-current" />
              <span class="grow">Reasoning</span>
              <input
                type="checkbox"
                class="toggle toggle-xs toggle-accent"
                checked
                disabled
                :aria-label="REASONING_ALWAYS_ON_TITLE"
              >
            </label>
          </li>
          <template v-else-if="hasReasoningSection && !isDeepResearchModel">
            <ChatInputReasoningMenuItems
              :reasoning="reasoning ?? 'off'"
              :levels="levels ?? []"
              :can-disable="canDisableReasoning"
              @select-level="emit('select-reasoning-level', $event)"
            />
          </template>
          <li v-if="isDeepResearchModel && research">
            <div class="flex items-center gap-2 pointer-events-none">
              <Icon name="lucide:telescope" size="16" class="text-accent" />
              <span class="flex flex-col items-start">
                <span>Deep research</span>
                <span class="text-[.65rem] font-normal opacity-70">
                  {{ research.costEstimate }} · {{ research.timeEstimate }}
                </span>
              </span>
            </div>
          </li>
          <template v-if="hasWebSearchSection">
            <ChatInputWebSearchMenuItems
              :selected="selectedWebSearchProvider ?? 'off'"
              :options="webSearchOptions ?? []"
              :is-tool-calling-supported="!!isToolCallingSupported"
              :exa-search-level="exaSearchLevel"
              @select-provider="emit('select-web-search-provider', $event)"
              @select-exa-search-level="
                emit('select-exa-search-level', $event)
              "
            />
          </template>
          <li
            v-if="hasReasoningSection
              || hasAlwaysOnReasoningRow
              || hasWebSearchSection"
          >
            <label class="menu-title text-xs">
              <span class="divider my-0"/>
            </label>
          </li>
          <li v-if="displayProjectPicker || projectContext" class="w-full">
            <div class="flex items-center gap-2 w-full">
              <button
                type="button"
                class="flex items-center gap-2 grow min-w-0 text-left"
                :class="{
                  'text-accent': projectContext
                }"
                @click="emit('open-project-picker')"
              >
                <Icon
                  :name="projectContext
                    ? 'lucide:check'
                    : 'lucide:folder'"
                  size="16"
                  class="shrink-0"
                />
                <span class="min-w-0 truncate">
                  {{ projectContext ? projectContext.name : 'Project' }}
                </span>
              </button>
            </div>
          </li>
          <li v-if="!isDeepResearchModel">
            <button
              type="button"
              class="flex items-center gap-2 w-full"
              @click="emit('open-files-select')"
            >
              <Icon name="lucide:paperclip" size="16" />
              <span class="grow">Attach files</span>
              <span
                v-if="(filesCount ?? 0) > 0"
                class="badge badge-accent badge-xs text-[.5rem]"
              >
                {{ filesCount }}
              </span>
            </button>
          </li>
          <li v-if="isImageGenerationSupported && !isDeepResearchModel">
            <label
              class="flex items-center gap-2"
              :class="{ 'cursor-pointer': !isImageGenerationRequired }"
            >
              <Icon name="lucide:image-plus" size="16" />
              <span class="grow">Create image</span>
              <input
                type="checkbox"
                class="toggle toggle-xs toggle-accent"
                :checked="isImageGenerationEnabled"
                :disabled="isImageGenerationRequired"
                :aria-label="isImageGenerationRequired
                  ? 'Image creation is required for this model'
                  : 'Create image'
                "
                @change="emit('toggle-image-generation')"
              >
            </label>
          </li>
        </ul>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'
import type { ModelResearchConfig } from '#shared/types/research.d'
import { REASONING_ALWAYS_ON_TITLE } from '#shared/utils/reasoning'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '~/types/web-search'

const props = withDefaults(defineProps<{
  isWebSearchSupported?: boolean
  isWebSearchEnabled?: boolean
  isToolCallingSupported?: boolean
  webSearchOptions?: WebSearchOption[]
  selectedWebSearchProvider?: WebSearchSelection
  exaSearchLevel?: ExaSearchLevel
  isImageGenerationSupported?: boolean
  isImageGenerationEnabled?: boolean
  isImageGenerationRequired?: boolean
  isReasoningSupported?: boolean
  isReasoningAlwaysOn?: boolean
  isReasoningActive?: boolean
  reasoning?: ReasoningLevel
  levels?: ReasoningEnabledLevel[]
  canDisableReasoning?: boolean
  isDeepResearchModel?: boolean
  research?: ModelResearchConfig | null
  displayProjectPicker?: boolean
  projectContext?: {
    id: string
    name: string
  } | null
  filesCount?: number
}>(), {
  canDisableReasoning: true,
})

const emit = defineEmits<{
  'select-web-search-provider': [value: WebSearchSelection]
  'select-exa-search-level': [level: ExaSearchLevel]
  'toggle-image-generation': []
  'open-project-picker': []
  'clear-project-context': []
  'open-files-select': []
  'open-files-upload': []
  'select-reasoning-level': [level: ReasoningLevel]
}>()

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

const isAnyFeatureActive = computed<boolean>(() => {
  return !!(
    props.isWebSearchEnabled
    || props.isImageGenerationEnabled
    || props.isReasoningActive
    || props.isDeepResearchModel
    || (props.filesCount ?? 0) > 0
    || props.projectContext
  )
})

const hasReasoningSection = computed<boolean>(() => {
  return !!(
    (props.isReasoningSupported
      && !props.isDeepResearchModel
      && !props.isImageGenerationEnabled
      && !props.isImageGenerationRequired)
    || (props.isDeepResearchModel && props.research)
  )
})

const hasAlwaysOnReasoningRow = computed<boolean>(() => {
  return !!(
    props.isReasoningAlwaysOn
    && !props.isDeepResearchModel
    && !props.isImageGenerationEnabled
    && !props.isImageGenerationRequired
  )
})

const hasWebSearchSection = computed<boolean>(() => {
  return !!(
    (props.isWebSearchSupported || props.isToolCallingSupported)
    && !props.isDeepResearchModel
    && !props.isImageGenerationEnabled
    && !props.isImageGenerationRequired
  )
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
</script>
