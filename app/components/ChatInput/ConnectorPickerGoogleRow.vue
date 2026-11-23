<template>
  <div
    class="flex flex-col"
    :aria-busy="isChoiceLoading || undefined"
    :data-testid="`connector-picker-google-${row.service}`"
  >
    <div
      class="flex w-full items-center gap-3 rounded-box px-3 py-2 hover:bg-base-200 max-sm:min-h-11"
    >
      <span
        class="grid size-8 shrink-0 place-items-center rounded-field bg-base-200"
        aria-hidden="true"
      >
        <Icon
          :name="row.icon"
          size="20"
        />
      </span>
      <component
        :is="row.kind === 'switch' ? 'label' : 'span'"
        :for="row.kind === 'switch' ? inputId : undefined"
        class="flex min-w-0 grow flex-col"
        :class="{
          'cursor-pointer': row.kind === 'switch' && !isInert,
          'cursor-not-allowed': row.kind === 'switch' && isInert,
        }"
      >
        <span class="truncate text-sm font-medium">
          {{ row.title }}
        </span>
        <span
          class="truncate text-xs text-base-content/60"
          :data-testid="`connector-picker-google-subline-${row.service}`"
        >
          {{ subLine }}
        </span>
      </component>
      <span
        v-if="isChoiceLoading"
        class="loading loading-spinner loading-xs shrink-0 text-base-content/60"
        role="presentation"
        :data-testid="`connector-picker-google-loading-${row.service}`"
      />
      <span
        v-if="isChoiceLoading"
        class="sr-only"
      >
        Loading
      </span>
      <button
        v-if="row.reasonNote"
        type="button"
        class="inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-base-content/60 hover:text-accent max-sm:size-11"
        :aria-label="`Why ${row.title} is not available with this model`"
        :aria-expanded="isNoteOpen"
        :aria-controls="noteId"
        :data-testid="`connector-picker-google-info-${row.service}`"
        @click="isNoteOpen = !isNoteOpen"
      >
        <Icon
          name="lucide:info"
          size="16"
          aria-hidden="true"
        />
      </button>
      <input
        v-if="row.kind === 'switch'"
        :id="inputId"
        type="checkbox"
        class="toggle toggle-sm toggle-accent shrink-0"
        :class="{ 'opacity-60': isBlocked }"
        role="switch"
        :checked="row.isOn"
        :disabled="isDisabled"
        :aria-disabled="isBlocked || undefined"
        :aria-label="`Use ${row.title} in this chat`"
        :data-testid="`connector-picker-google-toggle-${row.service}`"
        @click="onClick"
        @change="onChange"
      >
      <NuxtLink
        v-else-if="row.link"
        :to="row.link.path"
        class="btn btn-sm min-h-11 shrink-0 sm:min-h-8"
        :data-testid="`connector-picker-google-link-${row.service}`"
        @click="emit('navigate')"
      >
        {{ row.link.label }}
      </NuxtLink>
    </div>
    <ChatInputToolsMenuInfoNote
      v-if="row.reasonNote"
      v-show="isNoteOpen"
      :id="noteId"
      class="mx-3 mt-1 mb-2"
      :data-testid="`connector-picker-google-note-${row.service}`"
    >
      {{ row.reasonNote.detail }}
    </ChatInputToolsMenuInfoNote>
  </div>
</template>

<script setup lang="ts">
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import type {
  ComposerGoogleRow,
  GoogleChoiceState,
} from '~/composables/composer-google-tools'

const props = withDefaults(defineProps<{
  row: ComposerGoogleRow
  isSaving: boolean
  choiceState?: GoogleChoiceState
}>(), {
  choiceState: 'ready',
})

const emit = defineEmits<{
  toggle: [service: GoogleService]
  navigate: []
}>()

const inputId = useId()
const noteId = useId()
const isNoteOpen = shallowRef<boolean>(false)

const isDisabled = computed<boolean>(() => {
  return props.row.reasonNote !== null
})

const isChoiceLoading = computed<boolean>(() => {
  return props.row.kind === 'switch' && props.choiceState === 'loading'
})

const isBlocked = computed<boolean>(() => {
  return props.isSaving
    || (props.row.kind === 'switch' && props.choiceState !== 'ready')
})

const isInert = computed<boolean>(() => {
  return isDisabled.value || isBlocked.value
})

const subLine = computed<string>(() => {
  return isChoiceLoading.value ? 'Checking this chat' : props.row.subLine
})

function onClick(event: Event) {
  if (isBlocked.value) {
    event.preventDefault()
  }
}

function onChange(event: Event) {
  if (isBlocked.value) {
    (event.target as HTMLInputElement).checked = props.row.isOn

    return
  }

  emit('toggle', props.row.service)
}
</script>
