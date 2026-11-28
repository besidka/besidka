<template>
  <li
    class="list-row relative items-center gap-3 py-3 transition-colors"
    :class="isSelected ? 'bg-base-200' : 'hover:bg-base-200/60'"
    :data-testid="`google-entry-row-${entry.id}`"
  >
    <div
      class="avatar shrink-0"
      aria-hidden="true"
    >
      <div class="grid w-8 place-items-center rounded-full bg-base-200">
        <Icon
          :name="entry.icon"
          size="20"
        />
      </div>
    </div>
    <div class="list-col-grow min-w-0">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="link no-underline block min-w-0 cursor-pointer truncate text-left font-medium after:absolute after:inset-0 after:rounded-box after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
          data-testid="google-entry-row-open"
          @click="emit('open', entry.id)"
        >
          {{ entry.title }}
        </button>
        <span
          class="badge badge-soft badge-sm shrink-0"
          data-testid="google-entry-row-badge"
        >
          Built in
        </span>
      </div>
      <p
        class="mt-1 break-all text-xs font-medium"
        data-testid="google-entry-row-state"
      >
        {{ entry.stateLine }}
      </p>
      <p
        class="mt-1 line-clamp-2 text-xs text-base-content/70"
        data-testid="google-entry-row-description"
      >
        {{ entry.description }}
      </p>
    </div>
    <NuxtLink
      v-if="entry.action === 'link' && entry.linkPath"
      :to="entry.linkPath"
      class="btn btn-sm relative z-10 min-h-11 shrink-0 sm:min-h-8"
      :class="ACTION_PLACEMENT"
      :aria-label="actionAriaLabel"
      data-testid="google-entry-row-action"
    >
      {{ entry.actionLabel }}
    </NuxtLink>
    <button
      v-else-if="entry.action && entry.action !== 'disconnect'"
      type="button"
      class="btn btn-sm relative z-10 min-h-11 shrink-0 sm:min-h-8"
      :class="[ACTION_PLACEMENT, { 'btn-primary': isPrimaryAction }]"
      :disabled="isBusy"
      :aria-busy="isBusy"
      :aria-label="actionAriaLabel"
      data-testid="google-entry-row-action"
      @click="emit('action', entry)"
    >
      {{ entry.actionLabel }}
    </button>
  </li>
</template>

<script setup lang="ts">
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import type { GoogleEntry } from '~/utils/google-entries'

const ACTION_PLACEMENT = 'col-start-2 row-start-2 justify-self-start '
  + 'sm:col-start-3 sm:row-start-1 sm:justify-self-auto'

const props = withDefaults(defineProps<{
  entry: GoogleEntry
  isBusy?: boolean
  isSelected?: boolean
}>(), {
  isBusy: false,
  isSelected: false,
})

const emit = defineEmits<{
  open: [entryId: GoogleEntryId]
  action: [entry: GoogleEntry]
}>()

const isPrimaryAction = computed<boolean>(() => {
  return props.entry.action === 'connect'
    || props.entry.action === 'reconnect'
    || props.entry.action === 'add-access'
})

const actionAriaLabel = computed<string>(() => {
  const label = props.entry.actionLabel ?? ''

  return label.includes(props.entry.title)
    ? label
    : `${label}, ${props.entry.title}`
})
</script>
