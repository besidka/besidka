<template>
  <li
    class="card card-border card-sm relative transition-colors hover:bg-base-200/60"
    data-testid="connector-directory-card"
  >
    <div class="card-body gap-2">
      <div class="flex items-start gap-3">
        <ProfileConnectorsAvatar
          :title="item.title"
          :registry-id="isPreset ? null : item.id"
          :preset-id="item.presetId"
          size="lg"
        />
        <div class="min-w-0 grow">
          <p class="flex min-w-0 items-center gap-1 font-medium">
            <button
              type="button"
              class="min-w-0 truncate text-left after:absolute after:inset-0 after:rounded-box after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
              :aria-label="`Details of ${item.title}`"
              data-testid="connector-directory-open"
              @click="emit('open', item)"
            >
              {{ item.title }}
            </button>
            <span
              v-if="item.isCurated"
              class="tooltip tooltip-bottom relative z-10 inline-flex shrink-0"
              :data-tip="FEATURED_CONNECTOR_TIP"
            >
              <Icon
                name="lucide:badge-check"
                size="16"
                class="text-info"
                role="img"
                tabindex="0"
                :aria-label="`Featured. ${FEATURED_CONNECTOR_TIP}`"
                data-testid="connector-directory-featured"
              />
            </span>
            <span
              v-else
              class="badge badge-soft badge-xs shrink-0"
              data-testid="connector-directory-community"
            >
              Community
            </span>
          </p>
          <p
            v-if="item.publisher"
            class="truncate text-xs text-base-content/70"
            data-testid="connector-directory-publisher"
          >
            by {{ item.publisher }}
          </p>
        </div>
        <span
          v-if="item.isAdded"
          class="badge badge-soft badge-success badge-sm relative z-10 shrink-0 gap-1"
          data-testid="connector-directory-added"
        >
          <Icon
            name="lucide:check"
            size="12"
            aria-hidden="true"
          />
          Added
        </span>
        <button
          v-else
          type="button"
          class="btn btn-primary btn-sm relative z-10 shrink-0 min-h-11 sm:min-h-8"
          :aria-label="`Add ${item.title}`"
          data-testid="connector-directory-add"
          @click="emit('add', item)"
        >
          Add
        </button>
      </div>
      <p
        v-if="item.description"
        class="line-clamp-2 break-words text-sm text-base-content/80"
      >
        {{ item.description }}
      </p>
      <p class="truncate text-xs text-base-content/70">
        <span class="font-mono">{{ item.host }}</span>
        <span aria-hidden="true"> · </span>
        {{ getDirectoryCardAuthLabel(item) }}
      </p>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { ConnectorDirectoryItem } from '#shared/types/connectors.d'

const props = defineProps<{
  item: ConnectorDirectoryItem
}>()

const emit = defineEmits<{
  open: [item: ConnectorDirectoryItem]
  add: [item: ConnectorDirectoryItem]
}>()

const isPreset = computed<boolean>(() => {
  return isDirectoryPresetItem(props.item)
})
</script>
