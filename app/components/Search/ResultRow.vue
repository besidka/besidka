<template>
  <div
    data-testid="search-result-row"
    class="rounded-box px-3 py-2 cursor-pointer transition-colors"
    :class="active ? 'bg-base-content/10' : 'hover:bg-base-content/5'"
    @click="emit('select')"
  >
    <span class="block truncate text-sm font-medium">
      {{ chat.title || 'Untitled Chat' }}
    </span>
    <div class="flex flex-wrap items-center gap-2 mt-0.5">
      <span class="text-xs opacity-50 truncate">
        {{ activityAge }}
      </span>
      <span
        v-if="chat.projectName"
        class="badge badge-ghost badge-sm gap-1"
      >
        <Icon name="lucide:folder" size="10" />
        {{ chat.projectName }}
      </span>
      <span
        v-if="chat.shared"
        data-testid="chat-shared-badge"
        class="badge badge-ghost badge-sm gap-1"
      >
        <Icon name="lucide:link" size="10" />
        Shared
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'
import { formatActivityAge } from '#shared/utils/date-groups'

const props = defineProps<{
  chat: HistoryChat
  active: boolean
}>()

const emit = defineEmits<{
  select: []
}>()

const activityAge = computed<string>(() => {
  return formatActivityAge(new Date(props.chat.activityAt))
})
</script>
