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
    <div class="flex items-center justify-between gap-3 mb-6">
      <h1
        data-testid="shared-chat-title"
        class="text-xl font-semibold truncate"
      >
        {{ data.title || 'Shared chat' }}
      </h1>
      <UiButton
        v-if="loggedIn"
        data-testid="shared-fork-button"
        text="Add to my chats"
        icon-name="lucide:git-fork"
        :disabled="isForking"
        @click="forkChat"
      />
      <UiButton
        v-else
        data-testid="shared-fork-button"
        to="/signin"
        text="Sign in to add to your chats"
        icon-name="lucide:git-fork"
      />
    </div>
    <ChatContainer class="!gap-0">
      <div
        v-for="m in data.messages"
        :key="`message-${m.id}`"
        class="mt-3 first:mt-0"
      >
        <ChatMessage
          :role="m.role"
          :message-id="m.id"
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
        <SharedMessageMeta
          v-if="data.showMetadata"
          :role="m.role"
          :created-at="m.createdAt"
        />
      </div>
    </ChatContainer>
  </template>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { parseError } from 'evlog'

interface SharedChatMessage {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  reasoning: ReasoningLevel
  createdAt?: string | number
}

interface SharedChatResponse {
  title: string
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  messages: SharedChatMessage[]
}

definePageMeta({
  auth: false,
})

const route = useRoute()

const key = computed<string>(() => {
  return `shared-${route.params.slug}`
})

const { data, error } = await useFetch<SharedChatResponse>(
  () => `/api/v1/shared/${route.params.slug}`,
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
      href: () => `${baseUrl}/shared/${route.params.slug}`,
    },
  ],
})

const { components, getUnwrap } = useChatFormat()
const { loggedIn } = useAuth()

const isForking = shallowRef<boolean>(false)

async function forkChat() {
  isForking.value = true

  try {
    const response = await $fetch<{ slug: string }>(
      `/api/v1/chats/shares/${route.params.slug}/fork`,
      { method: 'POST' },
    )

    await navigateTo(`/chats/${response.slug}`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to add chat to your chats',
      parsedException.why,
    )
  } finally {
    isForking.value = false
  }
}
</script>
