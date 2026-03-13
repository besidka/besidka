<template>
  <li
    class="list-row items-center gap-3 group py-3 sm:py-2"
    :class="{ 'bg-base-200': isSelected }"
  >
    <Transition
      enter-active-class="transition-all duration-150"
      leave-active-class="transition-all duration-150"
      enter-from-class="opacity-0 w-0 overflow-hidden"
      leave-to-class="opacity-0 w-0 overflow-hidden"
    >
      <div
        v-if="isSelectionMode"
        class="flex items-center"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          :checked="isSelected"
          @click="onToggleSelect"
        >
      </div>
    </Transition>

    <div class="list-col-grow flex-1 min-w-0">
      <NuxtLink
        :to="`/chats/${chat.slug}`"
        class="link no-underline rounded-box block truncate py-1 font-medium"
        :class="{ 'pointer-events-none': isSelectionMode }"
        @click.prevent="isSelectionMode && onToggleSelect($event)"
      >
        {{ chat.title || 'Untitled Chat' }}
      </NuxtLink>
      <div class="grid gap-2 mt-0.5">
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
      </div>
    </div>

    <HistoryActionsDropdown
      :chat="chat"
      :is-selection-mode="isSelectionMode"
      @pin="onPin"
      @rename="onRename"
      @delete="onDelete"
      @select="onEnterSelect"
      @add-to-project="onAddToProject"
      @remove-from-project="onRemoveFromProject"
    />
  </li>
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'
import { formatActivityAge } from '#shared/utils/date-groups'

const props = defineProps<{
  chat: HistoryChat
  isSelectionMode: boolean
  isSelected: boolean
  index: number
}>()

const emit = defineEmits<{
  pin: [chatId: string]
  rename: [chat: HistoryChat]
  delete: [chatId: string, slug: string]
  select: [chatId: string, index: number, shiftKey: boolean]
  enterSelect: [chatId: string, index: number]
  addToProject: [chat: HistoryChat]
  removeFromProject: [chatId: string, slug: string]
}>()

const activityAge = computed(() => {
  return formatActivityAge(new Date(props.chat.activityAt))
})

function onToggleSelect(event: MouseEvent) {
  emit('select', props.chat.id, props.index, event.shiftKey)
}

function onEnterSelect() {
  emit('enterSelect', props.chat.id, props.index)
}

function onPin() {
  emit('pin', props.chat.id)
}

function onRename() {
  emit('rename', props.chat)
}

function onDelete() {
  emit('delete', props.chat.id, props.chat.slug)
}

function onAddToProject() {
  emit('addToProject', props.chat)
}

function onRemoveFromProject() {
  emit('removeFromProject', props.chat.id, props.chat.slug)
}
</script>
