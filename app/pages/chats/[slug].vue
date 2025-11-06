<template>
  <div
    ref="scrollContainerRef"
    class="
      flex-1 overflow-y-auto
      pt-[var(--sat)] pb-[var(--sab)]
      [-webkit-overflow-scrolling:touch]
    "
  >
    <ChatContainer>
      <ClientOnly>
        <template #fallback>
          <ChatSkeleton :messages-length="messagesLength" />
        </template>
      </ClientOnly>
      <div
        v-for="({
          message: m,
          textParts,
          hasSources: msgHasSources,
        }, messageIndex) in messages"
        :key="`message-${m.id}`"
        :ref="messagesDomRefs.set"
        :class="{
          'opacity-0 pointer-events-none': hideMessages
        }"
        :data-role="m.role"
        :data-message-id="m.id"
      >
        <ChatMessage
          v-for="{ part, originalIndex } in textParts"
          :key="isLastAssistantMessage(messageIndex)
            ? `message-${m.id}-part-${originalIndex}-${status}`
            : `message-${m.id}-part-${originalIndex}`
          "
          :role="m.role"
          :class="{
            'opacity-0': status === 'streaming'
              && isLastUserMessage(messageIndex)
              && waitingForDimensions,
          }"
          data-markdown
        >
          <MDCCached
            :key="isLastAssistantMessage(messageIndex)
              ? `mdc-${m.id}-part-${originalIndex}-${status}`
              : `mdc-${m.id}-part-${originalIndex}`
            "
            :value="m.role === 'user'
              ? $sanitizeHtml(part.text)
              : part.text
            "
            :cache-key="isLastAssistantMessage(messageIndex)
              ? `mdc-${m.id}-part-${originalIndex}-${status}`
              : `mdc-${m.id}-part-${originalIndex}`
            "
            :components="components"
            :parser-options="{ highlight: false }"
            class="chat-markdown"
            :unwrap="getUnwrap(m.role)"
          />
          <LazyChatSources
            v-if="
              m.role === 'assistant'
                && msgHasSources
                && status === 'ready'
            "
            :message="m"
          />
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
    :messages-length="messagesLength"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    :display-regenerate="displayRegenerate"
    :display-stop="displayStop"
    :status="status"
    @submit="submit"
  />
</template>
<script setup lang="ts">
import type { ChatStatus } from 'ai'

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
  messages,
  messagesLength,
  input,
  submit,
  tools,
  status,
  isLoading,
  isStopped,
  stop,
  regenerate,
  displayRegenerate,
  displayStop,
} = useChat(toValue(chat.value))

const { components, getUnwrap } = useChatFormat()
const hideMessages = shallowRef<boolean>(true)

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const messagesEndRef = ref<HTMLDivElement | null>(null)

const nuxtApp = useNuxtApp()
const messagesDomRefs = useTemplateRefsList<HTMLDivElement>()

onMounted(() => {
  hideMessages.value = false

  nuxtApp.callHook('chat:rendered', scrollContainerRef)
})

const { spacerHeight, waitingForDimensions } = useChatScroll({
  scrollContainerRef,
  messagesEndRef,
  messagesDomRefs,
  status: status as Ref<ChatStatus>,
  messagesLength: messagesLength as Ref<number>,
})

function isLastUserMessage(index: number): boolean {
  const msg = messages.value[index]

  if (!msg || msg.message.role !== 'user') return false

  const lastMsg = messages.value[messages.value.length - 1]

  return index === messages.value.length - 1
    || (index === messages.value.length - 2 && lastMsg?.message.role === 'assistant')
}

function isLastAssistantMessage(index: number): boolean {
  const msg = messages.value[index]

  if (!msg || msg.message.role !== 'assistant') return false

  return index === messages.value.length - 1
}
</script>
