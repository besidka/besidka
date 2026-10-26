<template>
  <li
    class="
      rounded-box grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center
      gap-x-3 gap-y-1 p-3 hover:bg-base-content/5
      sm:grid-cols-[minmax(0,1fr)_auto_auto]
    "
    :data-item-id="item.id"
    data-testid="knowledge-item"
  >
    <button
      type="button"
      class="
        order-1 rounded-box min-w-0 text-left
        focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-accent
      "
      :title="name"
      data-testid="knowledge-item-open"
      @click="emit('edit', item)"
    >
      <span
        class="block truncate font-medium"
        data-testid="knowledge-item-name"
      >
        {{ name }}
      </span>
      <span
        v-if="item.description"
        class="block truncate text-xs text-base-content/60"
        data-testid="knowledge-item-description"
      >
        {{ item.description }}
      </span>
    </button>
    <div
      class="
        order-3 col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1
        text-xs text-base-content/60 sm:order-2 sm:col-span-1
        sm:justify-end
      "
    >
      <span
        class="badge badge-ghost badge-sm"
        data-testid="knowledge-item-type"
      >
        {{ typeLabel }}
      </span>
      <span data-testid="knowledge-item-size">{{ sizeLabel }}</span>
      <span data-testid="knowledge-item-updated">{{ updatedLabel }}</span>
      <span
        v-if="tokensLabel"
        data-testid="knowledge-item-tokens"
      >
        {{ tokensLabel }}
      </span>
      <button
        v-if="item.extractStatus === 'failed'"
        type="button"
        class="badge badge-soft badge-error badge-sm cursor-pointer"
        data-testid="knowledge-item-status"
        @click="emit('edit', item)"
      >
        failed – retry
      </button>
      <span
        v-else
        class="badge badge-soft badge-sm"
        :class="item.extractStatus === 'ready'
          ? 'badge-success'
          : 'badge-warning'"
        data-testid="knowledge-item-status"
      >
        {{ item.extractStatus === 'ready' ? 'ready' : 'no text found' }}
      </span>
    </div>
    <div class="order-2 flex shrink-0 items-center gap-1 sm:order-3">
      <button
        type="button"
        class="btn btn-ghost btn-ghost-legacy btn-sm btn-square"
        :aria-label="`Edit ${name}`"
        data-testid="knowledge-item-edit"
        @click="emit('edit', item)"
      >
        <Icon
          name="lucide:pencil"
          size="16"
        />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-ghost-legacy btn-sm btn-square text-error"
        :aria-label="`Remove ${name}`"
        :disabled="isRemoving"
        data-testid="knowledge-item-remove"
        @click="emit('remove', item)"
      >
        <span
          v-if="isRemoving"
          class="loading loading-spinner loading-xs"
        />
        <Icon
          v-else
          name="lucide:trash-2"
          size="16"
        />
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import { formatApproxTokens } from '#shared/utils/prompt-cache-estimate'

const props = defineProps<{
  item: KnowledgeItem
  tokens: number | null
  isRemoving?: boolean
}>()

const emit = defineEmits<{
  edit: [item: KnowledgeItem]
  remove: [item: KnowledgeItem]
}>()

const name = computed<string>(() => {
  return getKnowledgeItemName(props.item)
})

const tokensLabel = computed<string | null>(() => {
  if (props.tokens === null) {
    return null
  }

  if (props.tokens === 0 && props.item.extractStatus !== 'ready') {
    return null
  }

  return `~${formatApproxTokens(props.tokens)} tokens`
})

const typeLabel = computed<string>(() => {
  return getKnowledgeItemTypeLabel(props.item)
})

const updatedLabel = computed<string>(() => {
  return `Updated ${formatMemoryUpdatedAge(new Date(props.item.updatedAt))}`
})

const sizeLabel = computed<string>(() => {
  return formatKnowledgeBytes(props.item.sizeBytes ?? props.item.textBytes)
})
</script>
