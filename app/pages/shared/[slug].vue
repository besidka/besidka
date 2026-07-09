<template>
  <div
    v-if="isNotFound"
    data-testid="shared-not-found"
    class="flex flex-col items-center justify-center gap-3 py-24 text-center"
  >
    <Icon
      name="lucide:link-2-off"
      size="40"
      class="text-base-content/40"
    />
    <h1 class="text-lg font-medium">
      This shared chat is no longer available
    </h1>
    <p class="text-sm text-base-content/60 max-w-sm">
      The link may have expired, been revoked, or never existed.
    </p>
    <UiButton
      to="/"
      text="Go home"
    />
  </div>
  <template v-else-if="data">
    <ChatContainer class="!gap-0 pb-16">
      <div class="w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24">
        <div
          v-if="showOpenInSafariHint"
          data-testid="shared-open-in-safari-hint"
          role="alert"
          class="alert alert-info alert-soft mb-3 !shadow-lg"
        >
          <Icon name="lucide:info" size="16" class="shrink-0" />
          <span class="text-xs sm:text-sm">
            For the best experience, open this page in Safari — tap the
            ••• (or share) menu and choose "Open in Safari".
          </span>
          <UiButton
            circle
            ghost
            size="xs"
            text="Dismiss"
            icon-only
            icon-name="lucide:x"
            @click="dismissOpenInSafariHint"
          />
        </div>
        <UiBubble
          class="!block shadow-none transition-opacity"
          :class="{ 'opacity-90 blur-md': selectedMessageId !== null }"
        >
          <div
            class="
              flex flex-col gap-3
              md:flex-row md:items-center md:justify-between
            "
          >
            <div class="min-w-0">
              <h1
                data-testid="shared-chat-title"
                class="text-sm sm:text-base font-semibold truncate"
              >
                {{ data.title || 'Shared chat' }}
              </h1>
            </div>
            <div
              class="
                flex flex-col gap-2 shrink-0
                md:flex-row md:items-center
              "
            >
              <UiButton
                v-if="showOpenInApp"
                data-testid="shared-open-in-app"
                ghost
                text="Open in the app"
                icon-name="lucide:smartphone"
                size="sm"
                class="max-md:btn-block max-md:w-full"
                :disabled="isSendingToApp"
                @click="sendSharedChatToApp(shareSlug)"
              />
              <UiButton
                v-if="data.allowBranch && loggedIn"
                data-testid="shared-add-to-chats"
                text="Add To My Chats"
                icon-name="lucide:git-fork"
                size="sm"
                class="max-md:btn-block max-md:w-full"
                :disabled="isBranching"
                @click="branchSharedChat(shareSlug)"
              />
              <UiButton
                v-else-if="data.allowBranch"
                data-testid="shared-add-to-chats"
                to="/signin"
                text="Sign in to add to your chats"
                icon-name="lucide:git-fork"
                size="sm"
                class="max-md:btn-block max-md:w-full"
              />
            </div>
          </div>

          <details
            class="group collapse mt-4 md:mt-2"
            :open="isSettingsExpanded"
          >
            <summary
              data-testid="shared-settings-toggle"
              class="collapse-title flex items-center gap-1 p-0 text-xs"
              @click.prevent="isSettingsExpanded = !isSettingsExpanded"
            >
              <Icon name="lucide:settings-2" size="12" />
              <span>Share settings</span>
              <Icon
                name="lucide:chevron-right"
                class="
                  size-4 text-base-content/60 transition-transform
                  group-open:rotate-90
                "
              />
            </summary>
            <div
              v-if="isSettingsExpanded"
              class="collapse-content mt-3 px-0 pb-0"
            >
              <div class="flex flex-col gap-1.5">
                <div
                  v-for="setting in shareSettings"
                  :key="setting.label"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-xs text-base-content/70">
                    {{ setting.label }}
                  </span>
                  <span
                    class="text-sm font-medium"
                    :class="setting.enabled ? 'text-success' : 'text-error'"
                  >
                    {{ setting.enabled ? 'Yes' : 'No' }}
                  </span>
                </div>
              </div>
            </div>
          </details>
        </UiBubble>
      </div>
      <div
        v-for="m in data.messages"
        :key="`message-${m.id}`"
        ref="messagesDomRefs"
        class="relative mt-3 first:mt-0"
      >
        <ChatMessage
          :role="m.role"
          :message-id="m.id"
          :is-selected="selectedMessageId === m.id"
          :any-selected="selectedMessageId !== null"
          :author-name="data.author?.name ?? null"
          :author-image="data.author?.image ?? null"
          @select="onMessageSelect"
        >
          <ChatFiles :message="m" />
          <ChatDeepResearchMeta
            v-if="hasResearchMetaPart(m)"
            :message="m"
          />
          <ChatReasoning
            :message="m"
            :reasoning-level="m.reasoning"
            status="ready"
            :turn-started-at="0"
          />
          <div
            v-for="(part, index) in m.parts"
            :key="`message-${m.id}-part-${index}`"
          >
            <div
              v-if="isChatErrorTextPart(part)"
              class="chat-markdown"
            >
              <div class="alert alert-error alert-soft flex flex-col items-start gap-0 mt-2">
                <p
                  v-for="(line, lineIndex) in buildChatErrorLines(part.error)"
                  :key="`chat-error-${m.id}-part-${index}-line-${lineIndex}`"
                >
                  {{ line }}
                </p>
              </div>
            </div>
            <MDCCached
              v-else-if="part.type === 'text'"
              :key="`mdc-${m.id}-part-${index}`"
              :value="m.role === 'user'
                ? $sanitizeHtml(part.text)
                : part.text
              "
              :cache-key="`mdc-${m.id}-part-${index}`"
              :components="components"
              :parser-options="{ highlight: false }"
              class="chat-markdown js-message-text"
              :unwrap="getUnwrap(m.role)"
            />
          </div>
          <ChatUrlSources :message="m" />
        </ChatMessage>
      </div>
    </ChatContainer>

    <ClientOnly>
      <LazyChatContextMenu
        v-if="selectedMessageId"
        :key="selectedMessageId"
        :message-id="selectedMessageId"
        :anchor-el="selectedAnchorEl"
        :info="selectedMessageInfo"
        :pointer="selectedPointer"
        :show-branch="data.allowBranch"
        :copy-text="selectedMessageCopyText"
        @branch="onBranchFromMessage"
        @close="clearMessageSelection"
      />
    </ClientOnly>
  </template>
</template>

<script setup lang="ts">
import type { TextUIPart, UIMessage } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { setResponseHeader } from 'h3'
import { resolveMessageMenuInfo } from '#shared/utils/message-metadata'
import { buildShareDescription } from '#shared/utils/og-description'

interface SharedChatMessage {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  reasoning: ReasoningLevel
  createdAt?: string | number
  usage?: MessageUsage
}

interface SharedChatAuthor {
  name: string | null
  image: string | null
}

interface SharedChatResponse {
  title: string
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  showAuthorAvatar: boolean
  allowBranch: boolean
  author: SharedChatAuthor | null
  messages: SharedChatMessage[]
}

interface ShareSettingRow {
  label: string
  enabled: boolean
}

definePageMeta({
  auth: false,
  layout: 'shared',
})

const route = useRoute()

const shareSlug = computed<string>(() => route.params.slug as string)

const key = computed<string>(() => {
  return `shared-${shareSlug.value}`
})

const { data, error } = await useFetch<SharedChatResponse>(
  () => `/api/v1/shared/${shareSlug.value}`,
  { key },
)

const isNotFound = computed<boolean>(() => {
  return Boolean(error.value) || !data.value
})

if (import.meta.server && data.value) {
  const event = useRequestEvent()

  if (event) {
    setResponseHeader(
      event,
      'X-Robots-Tag',
      data.value.indexable ? 'index, follow' : 'noindex, nofollow',
    )
  }
}

const { baseUrl } = useRuntimeConfig().public

const description = computed<string>(() => {
  const firstUserMessage = data.value?.messages.find((message) => {
    return message.role === 'user'
  })

  return (
    buildShareDescription(firstUserMessage?.parts)
    || 'A conversation shared from Besidka.'
  )
})

useSeoMeta({
  title: () => data.value?.title || 'Shared chat',
  description: () => description.value,
  robots: () => data.value?.indexable ? 'index, follow' : 'noindex, nofollow',
  ogTitle: () => data.value?.title || 'Shared chat',
  ogDescription: () => description.value,
  ogUrl: () => `${baseUrl}/shared/${shareSlug.value}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => data.value?.title || 'Shared chat',
  twitterDescription: () => description.value,
})

useHead({
  link: [
    {
      rel: 'canonical',
      href: () => `${baseUrl}/shared/${shareSlug.value}`,
    },
  ],
})

const { components, getUnwrap } = useChatFormat()
const { loggedIn } = useAuth()
const {
  isBranching,
  isSendingToApp,
  sharedBranchTarget,
  branchSharedChat,
  sendSharedChatToApp,
} = useChatShare()

const { hapticRigid, hapticSoft } = useHaptics()
const nuxtApp = useNuxtApp()

const messagesDomRefs = useTemplateRef<HTMLDivElement[]>('messagesDomRefs')

const selectedMessageId = shallowRef<string | null>(null)
const selectedAnchorEl = shallowRef<HTMLElement | null>(null)
const selectedPointer = shallowRef<{ x: number, y: number } | null>(null)

function isTextUIPart(part: UIMessage['parts'][number]): part is TextUIPart {
  return part.type === 'text'
    && !isChatErrorTextPart(part)
    && part.text.trim().length > 0
}

const selectedMessageCopyText = computed<string | null>(() => {
  const selectedMessage = data.value?.messages.find((message) => {
    return message.id === selectedMessageId.value
  })

  const textParts = selectedMessage?.parts.filter(isTextUIPart) ?? []

  if (textParts.length === 0) {
    return null
  }

  return textParts.map(part => part.text).join('\n\n')
})

function onMessageSelect(
  messageId: string,
  pointer?: { x: number, y: number },
) {
  if (selectedMessageId.value === messageId) return

  hapticRigid()

  selectedMessageId.value = messageId
  selectedPointer.value = pointer ?? null

  nuxtApp.callHook('chat:message-selected', messageId)

  const messageIndex = data.value?.messages.findIndex((message) => {
    return message.id === messageId
  }) ?? -1

  selectedAnchorEl.value = messagesDomRefs.value?.[messageIndex] ?? null
}

function resetMessageSelection() {
  selectedMessageId.value = null
  selectedAnchorEl.value = null
  selectedPointer.value = null

  nuxtApp.callHook('chat:message-selected', null)
}

function clearMessageSelection() {
  hapticSoft()

  resetMessageSelection()
}

watch(shareSlug, () => {
  if (!selectedMessageId.value) {
    return
  }

  resetMessageSelection()
})

watch([data, shareSlug], ([nextData, nextShareSlug]) => {
  if (!nextData) {
    sharedBranchTarget.value = null

    return
  }

  sharedBranchTarget.value = {
    slug: nextShareSlug,
    allowBranch: nextData.allowBranch,
  }
}, { immediate: true })

onUnmounted(() => {
  sharedBranchTarget.value = null
})

const selectedMessageInfo = computed(() => {
  if (!data.value?.showMetadata) {
    return null
  }

  const menuMessages = data.value.messages.map((message) => {
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      reasoning: message.reasoning,
      createdAt: message.createdAt,
      metadata: {
        usage: message.usage,
        createdAt: message.createdAt,
      },
    }
  })

  return resolveMessageMenuInfo(menuMessages, selectedMessageId.value)
})

async function onBranchFromMessage(messageId: string) {
  if (!loggedIn.value) {
    await navigateTo('/signin')

    return
  }

  await branchSharedChat(shareSlug.value, messageId)
}

const isSettingsExpanded = shallowRef<boolean>(false)
const showOpenInSafariHint = shallowRef<boolean>(false)
const isExternalBrowser = shallowRef<boolean>(false)

const {
  data: pushStatus,
  execute: fetchPushStatus,
} = useLazyFetch('/api/v1/push/status', {
  server: false,
  immediate: false,
})

const showOpenInApp = computed<boolean>(() => {
  return isExternalBrowser.value
    && loggedIn.value
    && Boolean(pushStatus.value?.subscribed)
})

onMounted(async () => {
  showOpenInSafariHint.value = isIosInAppBrowser()
  isExternalBrowser.value = isExternalBrowserContext()

  if (isExternalBrowser.value && loggedIn.value) {
    await fetchPushStatus()
  }
})

function dismissOpenInSafariHint(): void {
  showOpenInSafariHint.value = false
}

const shareSettings = computed<ShareSettingRow[]>(() => {
  if (!data.value) {
    return []
  }

  return [
    {
      label: 'Allowed in search',
      enabled: data.value.indexable,
    },
    {
      label: 'Show images & file names',
      enabled: data.value.showFiles,
    },
    {
      label: 'Show message details',
      enabled: data.value.showMetadata,
    },
    {
      label: 'Allow branching',
      enabled: data.value.allowBranch,
    },
  ]
})
</script>
