<template>
  <div
    class="grid gap-2"
    data-testid="knowledge-items"
  >
    <ul
      v-if="preparingRows.length > 0"
      class="grid gap-1"
      aria-label="Files being prepared"
    >
      <li
        v-for="row in preparingRows"
        :key="row.key"
        class="
          rounded-box flex min-w-0 items-center justify-between gap-3 p-3
          text-sm
        "
        data-testid="knowledge-item-preparing"
      >
        <span class="min-w-0 truncate font-medium">{{ row.name }}</span>
        <span class="badge badge-soft badge-info badge-sm shrink-0">
          preparing…
        </span>
      </li>
    </ul>
    <ul
      v-for="group in groups"
      :key="group.folderId"
      class="grid gap-1"
      :data-folder-id="group.folderId"
      data-testid="knowledge-group"
    >
      <li class="min-w-0">
        <div class="flex min-w-0 items-center gap-1">
          <h4 class="min-w-0 flex-1">
            <button
              type="button"
              class="
                js-knowledge-group-toggle rounded-box flex w-full items-center
                gap-2 p-3 text-left hover:bg-base-content/5
                focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-inset focus-visible:ring-accent
              "
              :aria-expanded="isExpanded(group.folderId)"
              :aria-controls="
                isExpanded(group.folderId)
                  ? regionId(group.folderId)
                  : undefined
              "
              data-testid="knowledge-group-toggle"
              @click="toggle(group.folderId)"
            >
              <Icon
                name="lucide:chevron-right"
                size="16"
                class="shrink-0 transition-transform motion-reduce:transition-none"
                :class="{ 'rotate-90': isExpanded(group.folderId) }"
              />
              <Icon
                name="lucide:folder"
                size="16"
                class="shrink-0"
              />
              <span
                class="
                  flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1
                "
              >
                <span
                  class="max-w-full truncate font-medium"
                  data-testid="knowledge-group-name"
                >
                  {{ group.name }}
                </span>
                <span
                  class="badge badge-ghost badge-sm"
                  data-testid="knowledge-group-count"
                >
                  {{ group.items.length }}
                  {{ group.items.length === 1 ? 'file' : 'files' }}
                </span>
                <span
                  v-if="tokenModel"
                  class="text-xs text-base-content/60"
                  data-testid="knowledge-group-tokens"
                >
                  ~{{ formatApproxTokens(sumTokens(group.items)) }} tokens
                </span>
              </span>
            </button>
          </h4>
          <button
            v-if="syncableFolderIds.includes(group.folderId)"
            type="button"
            class="btn btn-ghost btn-ghost-legacy btn-sm shrink-0"
            :disabled="syncingFolderId !== null"
            :aria-label="`Sync ${group.name} now`"
            data-testid="knowledge-group-sync"
            @click="emit('sync', group.folderId)"
          >
            <span
              v-if="syncingFolderId === group.folderId"
              class="loading loading-spinner loading-xs"
            />
            <Icon
              v-else
              name="lucide:refresh-cw"
              size="16"
            />
            Sync now
          </button>
        </div>
        <ul
          v-if="isExpanded(group.folderId)"
          :id="regionId(group.folderId)"
          class="
            ml-4 mt-1 grid gap-1 border-l border-base-content/10 pl-3 sm:ml-6
          "
          data-testid="knowledge-group-items"
        >
          <ProjectsKnowledgeItem
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            :tokens="tokensFor(item)"
            :is-removing="removingId === item.id"
            @edit="emit('edit', $event)"
            @remove="emit('remove', $event)"
          />
        </ul>
      </li>
    </ul>
    <ul
      v-if="looseItems.length > 0"
      class="grid gap-1"
      aria-label="Files and notes"
      data-testid="knowledge-loose-items"
    >
      <ProjectsKnowledgeItem
        v-for="item in looseItems"
        :key="item.id"
        :item="item"
        :tokens="tokensFor(item)"
        :is-removing="removingId === item.id"
        @edit="emit('edit', $event)"
        @remove="emit('remove', $event)"
      />
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import { formatApproxTokens } from '#shared/utils/prompt-cache-estimate'
import type {
  KnowledgeFolderNames,
  KnowledgeModelContext,
  KnowledgePreparingRow,
} from '~/types/knowledge-ui.d'

const props = withDefaults(defineProps<{
  items: KnowledgeItem[]
  tokenModel: KnowledgeModelContext | null
  folderNames?: KnowledgeFolderNames
  preparingRows?: KnowledgePreparingRow[]
  syncableFolderIds?: string[]
  syncingFolderId?: string | null
  removingId?: string | null
}>(), {
  folderNames: () => ({}),
  preparingRows: () => [],
  syncableFolderIds: () => [],
  syncingFolderId: null,
  removingId: null,
})

const emit = defineEmits<{
  edit: [item: KnowledgeItem]
  remove: [item: KnowledgeItem]
  sync: [folderId: string]
}>()

const idPrefix = useId()
const expandedFolderIds = shallowRef<string[]>([])

const grouped = computed(() => {
  return groupKnowledgeItems(props.items, props.folderNames)
})

const groups = computed(() => grouped.value.groups)
const looseItems = computed(() => grouped.value.looseItems)

function regionId(folderId: string): string {
  return `${idPrefix}-${folderId}`
}

function isExpanded(folderId: string): boolean {
  return expandedFolderIds.value.includes(folderId)
}

function toggle(folderId: string) {
  expandedFolderIds.value = isExpanded(folderId)
    ? expandedFolderIds.value.filter(id => id !== folderId)
    : [...expandedFolderIds.value, folderId]
}

function tokensFor(item: KnowledgeItem): number | null {
  if (!props.tokenModel) {
    return null
  }

  return estimateKnowledgeItemTokens(item, props.tokenModel)
}

function sumTokens(items: KnowledgeItem[]): number {
  return items.reduce((sum, item) => sum + (tokensFor(item) ?? 0), 0)
}
</script>
