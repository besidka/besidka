<template>
  <li
    class="
      list-row items-center gap-3 group py-3 sm:py-2 relative
      [&:has(details[open])]:z-30
    "
    :class="{ 'bg-base-200': isSelected }"
    data-testid="artifact-row"
    :data-artifact-id="artifact.id"
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
          :aria-label="`Select ${artifact.title}`"
          data-testid="artifact-row-checkbox"
          @click="onToggleSelect"
        >
      </div>
    </Transition>

    <div class="list-col-grow flex-1 min-w-0">
      <button
        type="button"
        class="link no-underline rounded-box block w-full truncate py-1 text-left font-medium disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        :class="{ 'after:absolute after:inset-0': isPicker }"
        :disabled="isOpenDisabled"
        :title="isOpenDisabled ? TAKEN_DOWN_TOOLTIP : undefined"
        data-testid="artifact-row-open"
        @click="onTitleClick"
      >
        {{ artifact.title }}
      </button>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70">
        <span
          class="badge badge-soft badge-sm gap-1"
          data-testid="artifact-row-kind"
        >
          <Icon
            :name="ARTIFACT_KIND_ICONS[artifact.kind]"
            size="10"
            aria-hidden="true"
          />
          {{ ARTIFACT_KIND_LABELS[artifact.kind] }}
        </span>
        <span data-testid="artifact-row-version">
          {{ versionLabel }}
        </span>
        <span>
          Updated
          <UiLocalDate :value="artifact.updatedAt" />
        </span>
        <span
          v-if="originLabel"
          class="flex min-w-0 items-center gap-1"
          data-testid="artifact-row-origin"
        >
          <Icon
            :name="originIcon"
            size="12"
            class="shrink-0"
            aria-hidden="true"
          />
          <NuxtLink
            v-if="artifact.originChatSlug && !isConnectedApp && !isPicker"
            :to="`/chats/${artifact.originChatSlug}`"
            class="link link-hover max-w-48 truncate"
            :class="{ 'pointer-events-none': isSelectionMode }"
            :tabindex="isSelectionMode ? -1 : undefined"
            data-testid="artifact-row-origin-link"
          >
            {{ originLabel }}
          </NuxtLink>
          <span
            v-else
            class="truncate"
          >
            {{ originLabel }}
          </span>
        </span>
        <span
          v-if="artifact.activeShareCount > 0"
          class="badge badge-soft badge-success badge-sm"
          data-testid="artifact-row-shared-badge"
        >
          Shared
        </span>
        <span
          v-if="artifact.takenDown"
          class="badge badge-soft badge-error badge-sm"
          data-testid="artifact-row-taken-down-badge"
        >
          Removed after a report
        </span>
      </div>
    </div>

    <div
      v-if="isSelectionMode"
      class="shrink-0 w-8 sm:w-6"
      aria-hidden="true"
    />
    <details
      v-else-if="!isPicker"
      ref="dropdownRef"
      class="
        dropdown dropdown-end relative z-20 open:z-40
        transition-opacity
        sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100
      "
      :class="isFlippedUp ? 'dropdown-top' : 'dropdown-bottom'"
      @toggle="updatePlacement"
    >
      <summary
        data-testid="artifact-row-actions-trigger"
        class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
        aria-label="Artifact actions"
      >
        <Icon name="lucide:ellipsis-vertical" size="16" />
      </summary>
      <div
        class="dropdown-content z-50 w-64"
        :class="isFlippedUp ? 'pb-2' : 'pt-2'"
        data-testid="artifact-row-actions-menu"
      >
        <ul
          tabindex="0"
          class="menu menu-sm bg-base-100 rounded-box shadow-lg w-64 p-1"
        >
          <li :class="{ 'menu-disabled': isOpenDisabled }">
            <button
              type="button"
              :disabled="isOpenDisabled"
              :title="isOpenDisabled ? TAKEN_DOWN_TOOLTIP : undefined"
              data-testid="artifact-action-open"
              @click="onOpen"
            >
              <Icon name="lucide:panel-right-open" size="14" />
              Open
            </button>
          </li>
          <li v-if="hasOriginChat">
            <NuxtLink
              :to="`/chats/${artifact.originChatSlug}`"
              data-testid="artifact-action-open-chat"
              @click="closeDropdown"
            >
              <Icon name="lucide:message-circle" size="14" />
              Open chat
            </NuxtLink>
          </li>
          <li>
            <button
              type="button"
              data-testid="artifact-action-select"
              @click="onSelect"
            >
              <Icon name="lucide:check-square" size="14" />
              Select
            </button>
          </li>
          <li v-if="canShare && !artifact.takenDown">
            <button
              type="button"
              data-testid="artifact-action-share"
              @click="onShare"
            >
              <Icon name="lucide:share-2" size="14" />
              Share…
            </button>
          </li>
          <li :class="{ 'menu-disabled': isOpenDisabled }">
            <button
              type="button"
              :disabled="isOpenDisabled"
              :title="isOpenDisabled ? TAKEN_DOWN_TOOLTIP : undefined"
              data-testid="artifact-action-download"
              @click="onDownload"
            >
              <Icon name="lucide:download" size="14" />
              Download
            </button>
          </li>
          <li>
            <button
              type="button"
              class="text-error"
              data-testid="artifact-action-delete"
              @click="onDelete"
            >
              <Icon name="lucide:trash-2" size="14" />
              Delete
            </button>
          </li>
        </ul>
      </div>
    </details>
  </li>
</template>

<script setup lang="ts">
import type { ArtifactSummary } from '#shared/utils/artifacts'
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
} from '~/utils/artifact-parts'

const TAKEN_DOWN_TOOLTIP = 'This artifact was removed after a report'
const CONNECTED_APP_LABEL = 'Created by a connected app'
const DELETED_CHAT_LABEL = 'Chat deleted'
const UNTITLED_CHAT_LABEL = 'Untitled chat'

const props = withDefaults(
  defineProps<{
    artifact: ArtifactSummary
    isSelectionMode?: boolean
    isSelected?: boolean
    index: number
    canShare?: boolean
    mode?: 'library' | 'picker'
  }>(),
  {
    isSelectionMode: false,
    isSelected: false,
    canShare: false,
    mode: 'library',
  },
)

const emit = defineEmits<{
  pick: [artifact: ArtifactSummary]
  open: [artifact: ArtifactSummary]
  share: [artifact: ArtifactSummary]
  download: [artifact: ArtifactSummary]
  delete: [artifact: ArtifactSummary]
  select: [artifactId: string, index: number, shiftKey: boolean]
  enterSelect: [artifactId: string, index: number]
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const { isFlippedUp, updatePlacement } = useDropdownPlacement(dropdownRef)

const isPicker = computed<boolean>(() => {
  return props.mode === 'picker'
})

const isConnectedApp = computed<boolean>(() => {
  return props.artifact.createdVia === 'mcp'
})

const hasOriginChat = computed<boolean>(() => {
  return !!props.artifact.originChatSlug && !isConnectedApp.value
})

const isOpenDisabled = computed<boolean>(() => {
  return props.artifact.takenDown && !props.isSelectionMode
})

const originLabel = computed<string>(() => {
  if (isConnectedApp.value) {
    return CONNECTED_APP_LABEL
  }

  if (props.artifact.originChatSlug) {
    return props.artifact.originChatTitle || UNTITLED_CHAT_LABEL
  }

  return DELETED_CHAT_LABEL
})

const originIcon = computed<string>(() => {
  if (isConnectedApp.value) {
    return 'lucide:plug'
  }

  return props.artifact.originChatSlug
    ? 'lucide:message-circle'
    : 'lucide:message-circle-off'
})

const versionLabel = computed<string>(() => {
  const { currentVersion, versionCount } = props.artifact

  return versionCount > 1
    ? `v${currentVersion} · ${versionCount} versions`
    : `v${currentVersion}`
})

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
    const activeElement = document.activeElement as HTMLElement | null

    activeElement?.blur()
  }
}

function onToggleSelect(event: MouseEvent) {
  emit('select', props.artifact.id, props.index, event.shiftKey)
}

function onTitleClick(event: MouseEvent) {
  if (props.isSelectionMode) {
    onToggleSelect(event)

    return
  }

  if (isPicker.value) {
    emit('pick', props.artifact)

    return
  }

  emit('open', props.artifact)
}

function onOpen() {
  closeDropdown()
  emit('open', props.artifact)
}

function onSelect() {
  closeDropdown()
  emit('enterSelect', props.artifact.id, props.index)
}

function onShare() {
  closeDropdown()
  emit('share', props.artifact)
}

function onDownload() {
  closeDropdown()
  emit('download', props.artifact)
}

function onDelete() {
  closeDropdown()
  emit('delete', props.artifact)
}
</script>
