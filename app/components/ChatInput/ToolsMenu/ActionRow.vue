<template>
  <button
    type="button"
    class="flex items-center gap-2.5 w-full min-h-9 max-md:min-h-11 px-2 py-1 rounded-box text-left text-sm cursor-pointer hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    :aria-keyshortcuts="keyShortcuts"
    @click="emit('click')"
  >
    <Icon
      v-if="icon"
      :name="icon"
      size="16"
      class="shrink-0 opacity-75"
    />
    <span class="flex flex-col grow min-w-0">
      <span class="leading-tight">{{ label }}</span>
      <span
        v-if="hint"
        class="text-xs leading-tight text-base-content/60"
      >
        {{ hint }}
      </span>
    </span>
    <span
      v-if="value || badge || shortcut || hasChevron"
      class="flex items-center gap-1 shrink-0 text-xs text-base-content/60"
    >
      <span
        v-if="value"
        class="max-w-32 truncate"
      >
        {{ value }}
      </span>
      <kbd
        v-if="shortcut"
        class="kbd kbd-xs"
      >
        {{ shortcut }}
      </kbd>
      <span
        v-if="badge"
        class="badge badge-accent badge-soft badge-xs font-bold"
      >
        {{ badge }}
      </span>
      <Icon
        v-if="hasChevron"
        name="lucide:chevron-right"
        size="14"
      />
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  icon?: string
  hint?: string
  value?: string
  badge?: number
  shortcut?: string
  keyShortcuts?: string
  hasChevron?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()
</script>
