<template>
  <div
    class="grid gap-6 py-4"
    data-testid="chat-context-panel"
  >
    <UiSidePanelSkeleton v-if="!data && !error" />
    <div
      v-else-if="error && !data"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="chat-context-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
      />
      <div class="grow">
        <p class="font-medium">
          Couldn't load this chat's context
        </p>
        <p class="text-sm">
          {{ errorMessage }}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="chat-context-retry"
        @click="refresh()"
      >
        Retry
      </button>
    </div>
    <template v-else-if="data">
      <header
        class="grid gap-3"
        data-testid="chat-context-header"
      >
        <h3
          class="text-lg font-semibold leading-snug break-words"
          data-testid="chat-context-title"
        >
          {{ data.chat.title || 'Untitled chat' }}
        </h3>
        <div
          v-if="hasHeaderBadges"
          class="flex flex-wrap items-center gap-1.5"
        >
          <NuxtLink
            v-if="project"
            :to="`/chats/projects/${project.id}`"
            class="badge badge-soft badge-sm gap-1 max-w-full"
            data-testid="chat-context-project"
          >
            <Icon
              name="lucide:folder"
              size="12"
              class="shrink-0"
            />
            <span class="truncate">{{ project.name }}</span>
          </NuxtLink>
          <span
            v-if="data.chat.cost"
            class="badge badge-soft badge-sm"
            :title="costTitle"
            data-testid="chat-context-cost"
          >
            {{ formatMessageCost(
              data.chat.cost.amount,
              data.chat.cost.isEstimated,
            ) }}
          </span>
          <span
            v-if="isShared"
            class="badge badge-soft badge-success badge-sm gap-1"
            data-testid="chat-context-shared"
          >
            <Icon
              name="lucide:link"
              size="12"
            />
            Shared
          </span>
          <span
            v-if="isMemoryExcluded"
            class="badge badge-soft badge-sm gap-1"
            :title="CHAT_MEMORY_EXCLUSION_HELPER"
            data-testid="chat-context-memory-excluded"
          >
            <Icon
              :name="CHAT_MEMORY_EXCLUSION_ICON"
              size="12"
            />
            {{ CHAT_MEMORY_EXCLUSION_INDICATOR }}
          </span>
        </div>
        <div
          v-if="hasActions"
          class="flex flex-wrap gap-2"
        >
          <button
            v-if="data.kind === 'owned' || canBranchShared"
            type="button"
            class="btn btn-sm btn-soft"
            :disabled="isBranching"
            data-testid="chat-context-branch"
            @click="onBranch"
          >
            <Icon
              name="lucide:git-branch-plus"
              size="16"
            />
            Branch
          </button>
          <button
            v-if="data.kind === 'owned'"
            type="button"
            class="btn btn-sm btn-soft"
            data-testid="chat-context-share"
            @click="onShare"
          >
            <Icon
              name="lucide:share-2"
              size="16"
            />
            Share
          </button>
          <button
            v-if="data.kind === 'owned'"
            type="button"
            class="btn btn-sm btn-soft"
            :disabled="memoryExclusionSavingSlug === routeSlug"
            :title="isMemoryExcluded
              ? CHAT_MEMORY_USE_HINT
              : CHAT_MEMORY_EXCLUSION_TOOLTIP"
            data-testid="chat-context-memory-exclusion"
            @click="onToggleMemoryExclusion"
          >
            <Icon
              :name="isMemoryExcluded
                ? CHAT_MEMORY_ICON
                : CHAT_MEMORY_EXCLUSION_ICON"
              size="16"
            />
            {{ memoryToggleLabel }}
          </button>
        </div>
      </header>
      <p
        v-if="data.truncated"
        class="text-xs text-base-content/60"
        data-testid="chat-context-truncated"
      >
        Based on the latest {{ maxMessagesLabel }} messages.
      </p>
      <p
        v-if="!visibleGroups.length"
        class="text-sm text-base-content/60"
        data-testid="chat-context-empty"
      >
        Nothing here yet. Outputs, files and sources from this chat will
        appear here.
      </p>
      <section
        v-for="group in visibleGroups"
        :key="group.id"
        class="grid gap-1"
        :aria-labelledby="`${idPrefix}-${group.id}`"
        :data-testid="`chat-context-section-${group.id}`"
      >
        <h4 :id="`${idPrefix}-${group.id}`">
          <button
            type="button"
            class="chat-context-section-toggle"
            :aria-expanded="!isGroupCollapsed(group)"
            :aria-controls="getControlledListId(group)"
            :data-testid="`chat-context-section-${group.id}-toggle`"
            @click="toggleGroup(group)"
          >
            <Icon
              name="lucide:chevron-right"
              size="14"
              class="shrink-0 transition-transform duration-150"
              :class="{ 'rotate-90': !isGroupCollapsed(group) }"
              aria-hidden="true"
            />
            {{ group.label }}
            <span class="font-normal normal-case tracking-normal">
              {{ group.total }}
            </span>
          </button>
        </h4>
        <div
          v-if="!isGroupCollapsed(group)"
          :id="`${idPrefix}-${group.id}-list`"
          class="grid gap-1"
        >
          <p
            v-if="group.total > group.items.length"
            class="px-2 text-xs text-base-content/60"
            :data-testid="`chat-context-section-${group.id}-capped`"
          >
            Showing the latest {{ group.items.length }}.
          </p>
          <ul
            class="grid max-h-[500px] gap-0.5 overflow-y-auto"
            :data-testid="`chat-context-section-${group.id}-list`"
          >
            <li
              v-for="item in group.items"
              :key="item.id"
            >
              <a
                v-if="item.href"
                :href="item.href"
                target="_blank"
                rel="noopener noreferrer"
                class="chat-context-row"
                :data-testid="`chat-context-item-${item.kind}`"
              >
                <ChatContextPanelItem :item="item" />
                <Icon
                  name="lucide:arrow-up-right"
                  size="12"
                  class="shrink-0 text-base-content/50"
                />
              </a>
              <button
                v-else
                type="button"
                class="chat-context-row"
                :data-testid="`chat-context-item-${item.kind}`"
                @click="onItemClick(item)"
              >
                <ChatContextPanelItem :item="item" />
              </button>
            </li>
          </ul>
          <div
            v-if="group.id === 'outputs' && hasAllArtifactsLink"
            class="mt-2 border-t border-base-300 pt-2"
          >
            <NuxtLink
              to="/chats/artifacts"
              class="chat-context-row min-h-11 text-sm"
              data-testid="chat-context-all-artifacts"
              @click="close"
            >
              <Icon
                name="lucide:app-window"
                size="14"
                class="shrink-0"
              />
              <span class="grow">All artifacts</span>
              <Icon
                name="lucide:arrow-right"
                size="12"
                class="shrink-0 text-base-content/50"
              />
            </NuxtLink>
          </div>
        </div>
      </section>
    </template>
    <LazyChatImagePreview
      v-if="previewImage && previewSourceUrl"
      v-model:open="isImagePreviewOpen"
      :src="previewSourceUrl"
      :download-url="previewDownloadUrl"
      :alt="previewImage.title"
      :filename="previewImage.title"
      :is-ai-generated="true"
    />
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  ChatContextChat,
  ChatContextItem,
} from '#shared/types/chat-context.d'
import { CHAT_CONTEXT_MAX_MESSAGES } from '#shared/utils/chat-context'
import { isArtifactKind } from '#shared/utils/artifacts'
import { formatMessageCost } from '#shared/utils/message-format'
import {
  CHAT_CONTEXT_USED_COLLAPSE_THRESHOLD,
  toSafeLocalUrl,
} from '~/utils/chat-context'

interface ContextGroup {
  id: 'outputs' | 'inputs' | 'used'
  label: string
  items: ChatContextItem[]
  total: number
}

const idPrefix = useId()
const { routeSlug } = useChatRoute()
const { data, error, refresh } = useChatContext()
const layout = useSidePanelLayout()
const { close } = useSidePanel()
const { open: openArtifact } = useArtifactPanel()
const artifactsFeature = useFeature('artifacts')
const {
  openShareModal,
  branchOwnedChat,
  branchSharedChat,
  sharedBranchTarget,
  isBranching,
  isModalOpen: isShareModalOpen,
} = useChatShare()
const {
  savingSlug: memoryExclusionSavingSlug,
  isChatMemoryExcluded,
  setChatMemoryExcluded,
} = useChatMemoryExclusion()

const collapsedOverrides = useState<Record<string, boolean>>(
  'chat-context-collapsed-sections',
  () => ({}),
)
const previewImage = shallowRef<ChatContextItem | null>(null)
const isImagePreviewOpen = shallowRef<boolean>(false)

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'Please try again.'
    : ''
})

const maxMessagesLabel = CHAT_CONTEXT_MAX_MESSAGES.toLocaleString('en-US')

const project = computed<ChatContextChat['project']>(() => {
  return data.value?.kind === 'owned' ? data.value.chat.project : null
})

const costTitle = computed<string>(() => {
  const parts = ['Chat total']

  if (data.value?.chat.cost?.isEstimated) {
    parts.push('partly estimated')
  }

  if (data.value?.truncated) {
    parts.push(`latest ${maxMessagesLabel} messages`)
  }

  return parts.join(', ')
})

const isShared = computed<boolean>(() => {
  return data.value?.kind === 'owned' && !!data.value.chat.share?.active
})

const isMemoryExcluded = computed<boolean>(() => {
  if (data.value?.kind !== 'owned') {
    return false
  }

  return isChatMemoryExcluded(routeSlug.value, data.value.chat.memoryExcluded)
})

const memoryToggleLabel = computed<string>(() => {
  return isMemoryExcluded.value
    ? CHAT_MEMORY_USE_LABEL
    : 'Exclude from memory'
})

const previewSourceUrl = computed<string | null>(() => {
  return toSafeLocalUrl(previewImage.value?.meta?.url)
})

const previewDownloadUrl = computed<string>(() => {
  const meta = previewImage.value?.meta

  return toSafeLocalUrl(meta?.downloadUrl) ?? previewSourceUrl.value ?? ''
})

const canBranchShared = computed<boolean>(() => {
  if (data.value?.kind !== 'shared') {
    return false
  }

  const target = sharedBranchTarget.value

  return data.value.chat.allowBranch
    && !!target?.allowBranch
    && target.slug === routeSlug.value
})

const hasHeaderBadges = computed<boolean>(() => {
  return !!project.value
    || !!data.value?.chat.cost
    || isShared.value
    || isMemoryExcluded.value
})

const hasActions = computed<boolean>(() => {
  return data.value?.kind === 'owned' || canBranchShared.value
})

const hasAllArtifactsLink = computed<boolean>(() => {
  return data.value?.kind === 'owned'
    && artifactsFeature.value.active
    && data.value.outputs.some((item) => {
      return item.kind === 'artifact'
    })
})

const visibleGroups = computed<ContextGroup[]>(() => {
  if (!data.value) {
    return []
  }

  const { counts } = data.value
  const groups: ContextGroup[] = [
    {
      id: 'outputs',
      label: 'Outputs',
      items: data.value.outputs,
      total: counts.outputs,
    },
    {
      id: 'inputs',
      label: 'Inputs',
      items: data.value.inputs,
      total: counts.inputs,
    },
    { id: 'used', label: 'Used', items: data.value.used, total: counts.used },
  ]

  return groups.filter((group) => {
    return group.items.length > 0
  })
})

watch(isShareModalOpen, (open, wasOpen) => {
  if (!open && wasOpen) {
    refresh()
  }
})

function isGroupCollapsed(group: ContextGroup): boolean {
  return collapsedOverrides.value[group.id]
    ?? (group.id === 'used'
      && group.total > CHAT_CONTEXT_USED_COLLAPSE_THRESHOLD)
}

function getControlledListId(group: ContextGroup): string | undefined {
  return isGroupCollapsed(group) ? undefined : `${idPrefix}-${group.id}-list`
}

function toggleGroup(group: ContextGroup) {
  collapsedOverrides.value = {
    ...collapsedOverrides.value,
    [group.id]: !isGroupCollapsed(group),
  }
}

function onShare() {
  openShareModal(routeSlug.value)
}

function onBranch() {
  if (data.value?.kind === 'shared') {
    branchSharedChat(routeSlug.value)

    return
  }

  branchOwnedChat(routeSlug.value)
}

async function onToggleMemoryExclusion() {
  await setChatMemoryExcluded(routeSlug.value, !isMemoryExcluded.value)
}

function scrollToMessage(messageId: string) {
  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  )

  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openArtifactItem(item: ChatContextItem): boolean {
  const meta = item.meta
  const artifactId = meta?.artifactId
  const isSharedContext = data.value?.kind === 'shared'
  const version = isSharedContext
    ? meta?.version
    : meta?.latestVersion ?? meta?.version

  if (!artifactId || !version) {
    return false
  }

  openArtifact({
    artifactId,
    version,
    kind: isArtifactKind(meta.artifactKind) ? meta.artifactKind : null,
    title: item.title,
    source: isSharedContext ? 'shared' : 'owner',
    shareSlug: isSharedContext ? routeSlug.value : undefined,
  }, { push: true })

  return true
}

async function onItemClick(item: ChatContextItem) {
  if (item.kind === 'artifact' && openArtifactItem(item)) {
    return
  }

  if (item.kind === 'image' && toSafeLocalUrl(item.meta?.url)) {
    previewImage.value = item
    isImagePreviewOpen.value = true

    return
  }

  if (layout.value === 'sheet') {
    close()
    await nextTick()
  }

  scrollToMessage(item.messageId)
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.chat-context-section-toggle {
  @apply flex w-full items-center gap-1.5 rounded-field px-2 py-1 text-left
    text-xs font-semibold uppercase tracking-wide text-base-content/60
    cursor-pointer transition-colors duration-150 hover:bg-base-200
    focus-visible:outline-2 focus-visible:-outline-offset-2
    focus-visible:outline-accent;
}

.chat-context-row {
  @apply flex w-full items-center gap-2 rounded-field px-2 py-1 text-left
    cursor-pointer transition-colors duration-150 hover:bg-base-200
    focus-visible:outline-2 focus-visible:-outline-offset-2
    focus-visible:outline-accent;
}
</style>
