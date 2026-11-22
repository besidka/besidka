<template>
  <div class="js-tools-content flex flex-col gap-0.5">
    <div
      v-if="state.isDeepResearchModel && state.research"
      class="flex items-center gap-2.5 px-2 py-1.5"
      data-testid="tools-deep-research-note"
    >
      <Icon
        name="lucide:telescope"
        size="16"
        class="shrink-0 text-accent"
      />
      <span class="flex flex-col text-sm">
        <span class="leading-tight">Deep research</span>
        <span class="text-xs leading-tight text-base-content/60">
          {{ state.research.costEstimate }} · {{ state.research.timeEstimate }}
        </span>
      </span>
    </div>
    <div
      v-if="state.isDeepResearchModel && state.research"
      class="h-px mx-2 my-1 bg-base-content/10"
      data-testid="tools-menu-divider"
    />
    <ChatInputToolsMenuSection
      id="steps"
      title="Steps"
      :icon="STEPS_SECTION_ICON"
      :is-highlighted="highlightedSection === 'steps'"
    >
      <ChatInputToolsMenuStepsSection />
    </ChatInputToolsMenuSection>
    <div
      v-if="hasDividerAfterSteps"
      class="h-px mx-2 my-1 bg-base-content/10"
      data-testid="tools-menu-divider"
    />
    <ChatInputToolsMenuSection
      v-if="state.memory.excluded !== null"
      id="memory"
      :label="CHAT_MEMORY_USE_LABEL"
      :is-highlighted="highlightedSection === 'memory'"
    >
      <ChatInputToolsMenuToggleRow
        :label="CHAT_MEMORY_USE_LABEL"
        :icon="CHAT_MEMORY_ICON"
        test-id="new-chat-memory-toggle"
        :extra-described-by="isMemoryNoteOpen ? memoryNoteId : undefined"
        :model-value="!state.memory.excluded"
        @update:model-value="emit('update:use-memory', $event)"
      >
        <template #label-extra>
          <button
            type="button"
            class="inline-grid place-items-center size-5 rounded-full text-base-content/60 hover:text-accent cursor-pointer"
            aria-label="About memory"
            :aria-expanded="isMemoryNoteOpen"
            :aria-controls="memoryNoteId"
            data-testid="new-chat-memory-info"
            @click.prevent="isMemoryNoteOpen = !isMemoryNoteOpen"
          >
            <Icon
              name="lucide:info"
              size="14"
            />
          </button>
        </template>
      </ChatInputToolsMenuToggleRow>
      <ChatInputToolsMenuInfoNote
        v-show="isMemoryNoteOpen"
        :id="memoryNoteId"
        class="mx-2 mt-1 mb-2 ml-8.5"
        data-testid="new-chat-memory-note"
      >
        {{ state.memory.excluded
          ? CHAT_MEMORY_EXCLUSION_HELPER
          : CHAT_MEMORY_USE_HINT }}
      </ChatInputToolsMenuInfoNote>
    </ChatInputToolsMenuSection>
    <ChatInputToolsMenuCodeExecutionSection
      v-if="state.codeExecution?.visible"
      :is-highlighted="highlightedSection === 'code'"
      :is-enabled="state.codeExecution.enabled"
      :provider-id="state.codeExecution.providerId"
      @toggle="emit('toggle-code-execution', $event)"
    />
    <ChatInputToolsMenuSection
      v-if="isImageRowVisible"
      id="image"
      label="Create image"
      :is-highlighted="highlightedSection === 'image'"
    >
      <ChatInputToolsMenuToggleRow
        label="Create image"
        icon="lucide:image-plus"
        :hint="state.image.required
          ? 'Required for this model'
          : 'Describe it in your message'"
        :aria-label="state.image.required
          ? 'Image creation is required for this model'
          : 'Create image'"
        test-id="tools-image-toggle"
        :model-value="state.image.enabled || state.image.required"
        :disabled="state.image.required"
        @update:model-value="emit('toggle-image-generation')"
      />
    </ChatInputToolsMenuSection>
    <div
      v-if="hasDividerAfterTopGroup"
      class="h-px mx-2 my-1 bg-base-content/10"
      data-testid="tools-menu-divider"
    />
    <ChatInputToolsMenuSection
      v-if="isReasoningSectionVisible"
      id="reasoning"
      title="Reasoning"
      :icon-component="REASONING_SECTION_ICON_COMPONENT"
      :is-highlighted="highlightedSection === 'reasoning'"
    >
      <ChatInputToolsMenuReasoningSection
        :mode="state.reasoning.mode === 'always-on'
          ? 'always-on'
          : 'configurable'"
        :reasoning="state.reasoning.level"
        :levels="state.reasoning.levels"
        :can-disable="state.reasoning.canDisable"
        :default-level="state.reasoning.defaultLevel"
        @select-level="emit('select-reasoning-level', $event)"
        @save-default="emit('save-default-reasoning-level', $event)"
      />
    </ChatInputToolsMenuSection>
    <div
      v-if="hasDividerBeforeSearch"
      class="h-px mx-2 my-1 bg-base-content/10"
      data-testid="tools-menu-divider"
    />
    <ChatInputToolsMenuWebSearchSection
      v-if="state.webSearch.visible"
      :is-highlighted="highlightedSection === 'search'"
      :selected="state.webSearch.selected"
      :options="state.webSearch.options"
      :is-tool-calling-supported="state.webSearch.isToolCallingSupported"
      :exa-search-level="state.webSearch.exaSearchLevel"
      :is-auto-available="state.webSearch.isAutoAvailable"
      :is-auto-preferred="state.webSearch.isAutoPreferred"
      :model-id="state.webSearch.modelId"
      :billing-provider-id="state.webSearch.billingProviderId"
      @select-provider="emit('select-web-search-provider', $event)"
      @select-exa-search-level="emit('select-exa-search-level', $event)"
      @toggle-auto="emit('toggle-auto-web-search', $event)"
    />
    <div
      v-if="hasDividerBeforeAdd"
      class="h-px mx-2 my-1 bg-base-content/10"
      data-testid="tools-menu-divider"
    />
    <ChatInputToolsMenuSection
      v-if="isAddSectionVisible"
      id="add"
      title="Add"
      icon="lucide:plus"
      :is-highlighted="highlightedSection === 'add'"
    >
      <ChatInputToolsMenuActionRow
        v-if="state.files.visible"
        label="Attach files"
        hint="Upload from your device"
        icon="lucide:paperclip"
        data-testid="tools-action-attach"
        @click="emit('open-files-upload')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.files.visible"
        label="Add from library"
        hint="Files you've uploaded"
        icon="lucide:folder-open"
        :badge="state.files.count || undefined"
        data-testid="tools-action-library"
        @click="emit('open-files-select')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.files.visible && state.files.isImageInputSupported"
        label="Generated images"
        hint="Images made in your chats"
        icon="lucide:images"
        data-testid="tools-action-generated"
        @click="emit('open-files-generated')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.files.visible && state.artifacts.visible"
        label="Add artifact"
        hint="Artifacts from your chats"
        icon="lucide:app-window"
        :badge="state.artifacts.attached.length || undefined"
        data-testid="tools-action-artifacts"
        @click="emit('open-artifact-picker')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.files.visible && state.googleDrive?.visible"
        :label="GOOGLE_DRIVE_BRAND_NAME"
        :hint="GOOGLE_DRIVE_COPY_LABEL"
        :icon="GOOGLE_DRIVE_ICON"
        :badge="state.googleDrive.importing || undefined"
        data-testid="tools-action-google-drive"
        @click="emit('open-google-drive')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.skills?.visible"
        label="Add skill"
        hint="Skills you made or imported"
        icon="lucide:sparkles"
        :badge="state.skills.selected ? 1 : undefined"
        data-testid="tools-action-skills"
        @click="emit('open-skills-picker')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.connectors?.visible"
        label="Connectors"
        hint="Let the model use your tools"
        icon="lucide:cable"
        :badge="connectorsBadge"
        data-testid="tools-action-connectors"
        @click="emit('open-connectors-picker')"
      />
      <ChatInputToolsMenuActionRow
        v-if="state.project.visible"
        :label="state.isNewChat ? 'Project' : 'Move to project'"
        icon="lucide:folder"
        :value="state.project.context?.name ?? 'None'"
        has-chevron
        data-testid="tools-project"
        @click="emit('open-project-picker')"
      />
    </ChatInputToolsMenuSection>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import {
  GOOGLE_DRIVE_BRAND_NAME,
  GOOGLE_DRIVE_COPY_LABEL,
  GOOGLE_DRIVE_ICON,
} from '#shared/utils/google-drive'
import type {
  ChatInputToolsState,
  ToolsSection,
} from '~/types/chat-input-tools'
import type { WebSearchSelection } from '~/types/web-search'

const props = defineProps<{
  state: ChatInputToolsState
  highlightedSection?: ToolsSection | null
}>()

const emit = defineEmits<{
  'select-web-search-provider': [value: WebSearchSelection]
  'select-exa-search-level': [level: ExaSearchLevel]
  'toggle-auto-web-search': [isOn: boolean]
  'toggle-image-generation': []
  'toggle-code-execution': [isOn: boolean]
  'select-reasoning-level': [level: ReasoningLevel]
  'save-default-reasoning-level': [level: ReasoningLevel]
  'open-project-picker': []
  'open-files-select': []
  'open-files-upload': []
  'open-files-generated': []
  'open-artifact-picker': []
  'open-google-drive': []
  'open-skills-picker': []
  'open-connectors-picker': []
  'update:use-memory': [value: boolean]
}>()

provideRevealGuardRoot()

const memoryNoteId = useId()
const isMemoryNoteOpen = shallowRef<boolean>(false)

const isReasoningSectionVisible = computed<boolean>(() => {
  return props.state.reasoning.visible
    && props.state.reasoning.mode !== 'none'
})

const connectorsBadge = computed<number | undefined>(() => {
  return countSelectedConnectors(props.state.connectors) || undefined
})

const isAddSectionVisible = computed<boolean>(() => {
  return props.state.files.visible
    || props.state.googleDrive?.visible === true
    || props.state.skills?.visible === true
    || props.state.connectors?.visible === true
    || props.state.project.visible
})

const hasDividerAfterSteps = computed<boolean>(() => {
  return hasTopGroup.value
    || isReasoningSectionVisible.value
    || props.state.webSearch.visible
    || isAddSectionVisible.value
})

const hasDividerAfterTopGroup = computed<boolean>(() => {
  return hasTopGroup.value && (
    isReasoningSectionVisible.value
    || props.state.webSearch.visible
    || isAddSectionVisible.value
  )
})

const hasDividerBeforeSearch = computed<boolean>(() => {
  return isReasoningSectionVisible.value && props.state.webSearch.visible
})

const hasDividerBeforeAdd = computed<boolean>(() => {
  return isAddSectionVisible.value && (
    isReasoningSectionVisible.value
    || props.state.webSearch.visible
  )
})

const isImageRowVisible = computed<boolean>(() => {
  return props.state.image.supported && !props.state.isDeepResearchModel
})

const isCodeExecutionRowVisible = computed<boolean>(() => {
  return props.state.codeExecution?.visible === true
})

const hasTopGroup = computed<boolean>(() => {
  return isImageRowVisible.value
    || isCodeExecutionRowVisible.value
    || props.state.memory.excluded !== null
})
</script>
