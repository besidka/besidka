<template>
  <div
    v-if="isLoadingInitial"
    class="flex flex-col gap-2"
  >
    <div
      v-for="index in 4"
      :key="index"
      class="flex items-center gap-3 rounded-box border border-base-200/70 px-3 py-3"
    >
      <div class="skeleton skeleton--default size-10 rounded-full shrink-0" />
      <div class="flex-1 space-y-2">
        <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
        <div class="skeleton skeleton--default h-3 w-1/3 rounded-full" />
      </div>
      <div class="skeleton skeleton--default h-9 w-9 rounded-full shrink-0" />
    </div>
  </div>

  <template v-else>
    <template v-if="pinned.length > 0">
      <div class="flex items-center gap-2">
        <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
          Pinned
        </span>
        <div class="flex-1 h-px bg-base-300" />
      </div>
      <ul class="list">
        <HistoryChatRow
          v-for="(chat, pinnedIndex) in pinned"
          :key="chat.id"
          :chat="chat"
          :index="pinnedIndex"
          :is-selection-mode="isSelectionMode"
          :is-selected="selectedIds.has(chat.id)"
          @pin="emit('pin', chat.id)"
          @rename="onRename"
          @delete="onDelete"
          @select="onSelect"
          @enter-select="onEnterSelect"
          @add-to-folder="onAddToFolder"
          @remove-from-folder="onRemoveFromFolder"
        />
      </ul>
    </template>

    <template v-if="chats.length > 0">
      <template
        v-for="group in groups"
        :key="group.label"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-60 uppercase tracking-wide font-semibold">
            {{ group.label }}
          </span>
          <div class="flex-1 h-px bg-base-300" />
        </div>
        <ul class="list">
          <HistoryChatRow
            v-for="chat in group.chats"
            :key="chat.id"
            :chat="chat"
            :index="flatChatIndexMap.get(chat.id) ?? 0"
            :is-selection-mode="isSelectionMode"
            :is-selected="selectedIds.has(chat.id)"
            @pin="emit('pin', chat.id)"
            @rename="onRename"
            @delete="onDelete"
            @select="onSelect"
            @enter-select="onEnterSelect"
            @add-to-folder="onAddToFolder"
            @remove-from-folder="onRemoveFromFolder"
          />
        </ul>
      </template>
    </template>

    <div
      v-if="showEmptyState"
      class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
    >
      <template v-if="emptyStateMode === 'search'">
        <Icon name="lucide:search-x" size="40" class="mx-auto mb-3 opacity-60" />
        <p class="font-medium">No chats match your search</p>
        <p class="mt-2 text-sm opacity-60">
          Try a different title or message keyword.
        </p>
      </template>
      <template v-else-if="emptyStateMode === 'folder'">
        <Icon
          name="lucide:folder-open"
          size="40"
          class="mx-auto mb-3 opacity-60"
        />
        <p class="font-medium">No chats in this folder yet</p>
        <p class="mt-2 mb-4 text-sm opacity-60">
          Start a conversation here to keep it grouped with this folder.
        </p>
        <NuxtLink
          v-if="emptyActionTo"
          :to="emptyActionTo"
          class="btn btn-primary btn-sm"
        >
          {{ emptyActionLabel || 'New chat' }}
        </NuxtLink>
      </template>
      <template v-else>
        <Icon
          name="lucide:message-circle"
          size="40"
          class="mx-auto mb-3 opacity-60"
        />
        <p class="font-medium">Start your first conversation</p>
        <p class="mt-2 mb-4 text-sm opacity-60">
          New chats you create will appear here automatically.
        </p>
        <NuxtLink
          v-if="emptyActionTo"
          :to="emptyActionTo"
          class="btn btn-primary btn-sm"
        >
          {{ emptyActionLabel || 'New chat' }}
        </NuxtLink>
      </template>
    </div>
  </template>
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'
import { groupByDate } from '#shared/utils/date-groups'

const props = withDefaults(
  defineProps<{
    pinned: HistoryChat[]
    chats: HistoryChat[]
    groupedAt?: Date | string
    isLoadingInitial: boolean
    isSelectionMode: boolean
    selectedIds?: Set<string>
    emptyStateMode: 'history' | 'folder' | 'search'
    emptyActionTo?: string
    emptyActionLabel?: string
  }>(),
  {
    selectedIds: () => new Set<string>(),
    groupedAt: undefined,
    emptyActionTo: undefined,
    emptyActionLabel: undefined,
  },
)

const emit = defineEmits<{
  'pin': [chatId: string]
  'rename': [chat: HistoryChat]
  'delete': [chatId: string, slug: string]
  'select': [chatId: string, index: number, shiftKey: boolean]
  'enter-select': [chatId: string, index: number]
  'add-to-folder': [chat: HistoryChat]
  'remove-from-folder': [chatId: string, slug: string]
}>()

const groups = computed(() => groupByDate(props.chats, props.groupedAt))

const flatChatIndexMap = computed(() => {
  const map = new Map<string, number>()

  props.chats.forEach((chat, index) => {
    map.set(chat.id, props.pinned.length + index)
  })

  return map
})

const showEmptyState = computed(() => {
  return !props.isLoadingInitial
    && props.pinned.length === 0
    && props.chats.length === 0
})

function onRename(chat: HistoryChat) {
  emit('rename', chat)
}

function onDelete(chatId: string, slug: string) {
  emit('delete', chatId, slug)
}

function onSelect(chatId: string, index: number, shiftKey: boolean) {
  emit('select', chatId, index, shiftKey)
}

function onEnterSelect(chatId: string, index: number) {
  emit('enter-select', chatId, index)
}

function onAddToFolder(chat: HistoryChat) {
  emit('add-to-folder', chat)
}

function onRemoveFromFolder(chatId: string, slug: string) {
  emit('remove-from-folder', chatId, slug)
}
</script>
