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
    <ChatContainer class="!gap-0 pb-2">
      <div class="w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24">
        <UiBubble class="!block shadow-none">
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
            <UiButton
              v-if="data.allowBranch && loggedIn"
              data-testid="shared-add-to-chats"
              text="Add To My Chats"
              icon-name="lucide:git-fork"
              size="sm"
              class="max-md:btn-block max-md:w-full shrink-0"
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
              class="max-md:btn-block max-md:w-full shrink-0"
            />
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
        class="mt-3 first:mt-0"
      >
        <ChatMessage
          :role="m.role"
          :message-id="m.id"
          :author-name="data.author?.name ?? null"
          :author-image="data.author?.image ?? null"
        >
          <ChatFiles :message="m" />
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
              class="chat-markdown"
              :unwrap="getUnwrap(m.role)"
            />
          </div>
          <ChatUrlSources :message="m" />
        </ChatMessage>
      </div>
    </ChatContainer>
  </template>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

interface SharedChatMessage {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  reasoning: ReasoningLevel
  createdAt?: string | number
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

useSeoMeta({
  title: () => data.value?.title || 'Shared chat',
  robots: () => data.value?.indexable ? 'index, follow' : 'noindex, nofollow',
})

const { baseUrl } = useRuntimeConfig().public

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
const { isBranching, branchSharedChat } = useChatShare()

const isSettingsExpanded = shallowRef<boolean>(false)

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
