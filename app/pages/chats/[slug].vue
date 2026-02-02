<template>
  <div
    ref="scrollContainerRef"
    class="
      overflow-y-auto overflow-x-hidden z-10
      flex-1
      pt-[var(--sat)] pb-[var(--sab)]
      [-webkit-overflow-scrolling:touch]
      mask-linear-1 mask-linear-from-base-100
      mask-linear-to-base-100
    "
  >
    <ChatContainer>
      <ClientOnly>
        <template #fallback>
          <ChatSkeleton :messages-length="chatSdk.messages.length" />
        </template>
      </ClientOnly>
      <div
        v-for="(m, messageIndex) in chatSdk.messages"
        :key="`message-${m.id}`"
        ref="messagesDomRefs"
        :data-role="m.role"
        :data-message-id="m.id"
        :data-hide-content="shouldDisplayMessage(m.id) ? undefined : true"
        class="
          [&[data-hide-content=true]_>_div]:hidden
          [&[data-hide-content=true]_+_div]:-top-3
        "
        :class="{
          'opacity-0 pointer-events-none': hideMessages,
        }"
      >
        <ChatMessage :role="m.role">
          <ChatReasoning
            :message="m"
            :status="chatSdk.status"
          />
          <div
            v-for="(part, index) in m.parts"
            :key="isLastAssistantMessage(messageIndex)
              ? `message-${m.id}-part-${index}-${chatSdk.status}`
              : `message-${m.id}-part-${index}`
            "
            :class="{
              'opacity-0': chatSdk.status === 'streaming'
                && isLastUserMessage(messageIndex)
                && waitingForDimensions,
            }"
          >
            <MDCCached
              v-if="part.type === 'text'"
              :key="isLastAssistantMessage(messageIndex)
                ? `mdc-${m.id}-part-${index}-${chatSdk.status}`
                : `mdc-${m.id}-part-${index}`
              "
              :value="m.role === 'user'
                ? $sanitizeHtml(part.text)
                : part.text
              "
              :cache-key="isLastAssistantMessage(messageIndex)
                ? `mdc-${m.id}-part-${index}-${chatSdk.status}`
                : `mdc-${m.id}-part-${index}`
              "
              :components="components"
              :parser-options="{ highlight: false }"
              class="chat-markdown"
              :unwrap="getUnwrap(m.role)"
            />
          </div>
          <ChatUrlSources :message="m" />
        </ChatMessage>
      </div>
      <LazyChatLoader :show="isLoading" />
      <div ref="messagesEndRef" />
    </ChatContainer>
    <div :style="{ height: `${spacerHeight}px` }" />
  </div>
  <ChatInput
    v-model:message="input"
    v-model:tools="tools"
    v-model:reasoning="isReasoningEnabled"
    :messages-length="chatSdk.messages.length"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    :display-regenerate="displayRegenerate"
    :display-stop="displayStop"
    :status="chatSdk.status"
    @submit="submit"
  />
</template>
<script setup lang="ts">
import type { Chat } from '#shared/types/chats.d'

definePageMeta({
  layout: 'chat',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'New Chat',
  robots: 'noindex, nofollow',
})

const route = useRoute()

const { data: chat, error: chatError } = await useFetch<Chat>(
  `/api/v1/chats/${route.params.slug}`,
  {
    key: `chat-${route.params.slug}`,
    cache: 'force-cache',
  },
)

if (chatError.value) {
  throw createError({
    statusCode: chatError.value.status || 500,
    statusMessage:
      chatError.value.statusMessage
      || 'An error occurred while fetching the chat',
    data: chatError.value,
  })
}

if (!chat.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Chat not found',
  })
}

useSeoMeta({
  title: chat.value.title || 'Untitled Chat',
})

const {
  chatSdk,
  input,
  submit,
  tools,
  isLoading,
  isStopped,
  stop,
  regenerate,
  displayRegenerate,
  displayStop,
  isReasoningEnabled,
  isLastUserMessage,
  isLastAssistantMessage,
  shouldDisplayMessage,
} = useChat(toValue(chat.value))

const { components, getUnwrap } = useChatFormat()
const hideMessages = shallowRef<boolean>(true)

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const messagesEndRef = ref<HTMLDivElement | null>(null)

const nuxtApp = useNuxtApp()
const messagesDomRefs = useTemplateRef<HTMLDivElement[]>('messagesDomRefs')

onMounted(() => {
  hideMessages.value = false

  nuxtApp.callHook('chat:rendered', scrollContainerRef)
})

const { spacerHeight, waitingForDimensions } = useChatScroll({
  scrollContainerRef,
  messagesEndRef,
  messagesDomRefs,
  chatSdk,
})
</script>
