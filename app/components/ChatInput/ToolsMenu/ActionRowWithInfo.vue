<template>
  <div
    class="flex flex-col"
    :data-testid="testId"
  >
    <div
      class="relative flex items-center gap-2.5 w-full min-h-9 max-md:min-h-11 px-2 py-1 rounded-box text-sm hover:bg-base-200"
    >
      <Icon
        v-if="icon"
        :name="icon"
        size="16"
        class="shrink-0 opacity-75"
      />
      <span class="flex flex-col grow min-w-0">
        <span class="inline-flex items-center gap-1 leading-tight">
          <button
            type="button"
            class="text-left cursor-pointer outline-none after:absolute after:inset-0 after:rounded-box focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
            :aria-describedby="mainDescribedBy"
            :data-testid="`${testId}-open`"
            @click="emit('click')"
          >
            {{ label }}
          </button>
          <button
            type="button"
            class="relative z-10 inline-grid place-items-center size-5 rounded-full text-base-content/60 hover:text-accent cursor-pointer"
            :aria-label="infoLabel"
            :aria-expanded="isNoteOpen"
            :aria-controls="noteId"
            :data-testid="`${testId}-info`"
            @click="isNoteOpen = !isNoteOpen"
          >
            <Icon
              name="lucide:info"
              size="14"
            />
          </button>
        </span>
        <span
          v-if="hint"
          :id="hintId"
          class="text-xs leading-tight text-base-content/60"
        >
          {{ hint }}
        </span>
      </span>
      <span
        v-if="isPending || badge"
        class="flex items-center gap-1 shrink-0 text-xs text-base-content/60"
      >
        <span
          v-if="isPending"
          class="loading loading-spinner loading-xs"
          :data-testid="`${testId}-pending`"
        />
        <span
          v-if="badge"
          class="badge badge-accent badge-soft badge-xs font-bold"
        >
          {{ badge }}
        </span>
      </span>
    </div>
    <ChatInputToolsMenuInfoNote
      v-show="isNoteOpen"
      :id="noteId"
      class="mx-2 mt-1 mb-2 ml-8.5"
      :data-testid="`${testId}-note`"
    >
      <slot />
    </ChatInputToolsMenuInfoNote>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  testId: string
  infoLabel: string
  icon?: string
  hint?: string
  badge?: number
  isPending?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()

const hintId = useId()
const noteId = useId()
const isNoteOpen = shallowRef<boolean>(false)

const mainDescribedBy = computed<string | undefined>(() => {
  const ids = [
    props.hint ? hintId : undefined,
    isNoteOpen.value ? noteId : undefined,
  ].filter(Boolean)

  return ids.length ? ids.join(' ') : undefined
})
</script>
