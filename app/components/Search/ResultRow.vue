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
    <p
      v-if="chat.snippet"
      data-testid="chat-row-snippet"
      class="truncate text-xs opacity-70 mt-0.5"
    >
      <template
        v-for="(segment, segmentIndex) in snippetSegments"
        :key="segmentIndex"
      >
        <mark
          v-if="segment.highlight"
          class="bg-transparent text-primary font-medium"
        >{{ segment.text }}</mark>
        <template v-else>{{ segment.text }}</template>
      </template>
    </p>
    <div class="flex flex-wrap items-center gap-2 mt-0.5">
      <span class="text-xs opacity-50 truncate">
        {{ activityAge }}
      </span>
      <span
        v-if="chat.pinnedAt"
        data-testid="chat-pinned-badge"
        class="badge badge-ghost badge-sm gap-1"
      >
        <Icon name="lucide:pin" size="10" />
      </span>
      <span
        v-if="chat.matchedIn === 'content'"
        data-testid="chat-content-match-badge"
        class="badge badge-ghost badge-sm gap-1"
      >
        <Icon name="lucide:message-square-text" size="10" />
        In messages
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
import { splitSnippetSegments } from '#shared/utils/search'

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

const snippetSegments = computed(() => {
  return props.chat.snippet ? splitSnippetSegments(props.chat.snippet) : []
})
</script>
