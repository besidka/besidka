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
    <ChatContainer class="!gap-0">
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
          mt-3 first:mt-0
        "
        :class="{
          'opacity-0 pointer-events-none': hideMessages,
        }"
      >
        <ChatMessage :role="m.role">
          <ChatFiles :message="m" />
          <ChatReasoning
            :message="m"
            :reasoning-level="getMessageReasoning(m, messageIndex)"
            :status="chatSdk.status"
          />
          <div
            v-for="(part, index) in m.parts"
            :key="`message-${m.id}-part-${index}`"
            :class="{
              'opacity-0': chatSdk.status === 'streaming'
                && isLastUserMessage(messageIndex)
                && waitingForDimensions,
            }"
          >
            <MDCCached
              v-if="part.type === 'text'"
              :key="`mdc-${m.id}-part-${index}`"
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
    v-model:files="files"
    v-model:tools="tools"
    v-model:reasoning="reasoning"
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

const isTestChat = computed<boolean>(() => {
  return import.meta.dev && route.path === '/chats/test'
})

const key = computed<string>(() => {
  if (!isTestChat.value) {
    return `chat-${route.params.slug}`
  }

  return `test-chat-${route.query.scenario}-${route.query.messages || 1}-${route.query.effort || 'medium'}`
})

const query = computed(() => {
  if (!isTestChat.value) {
    return {
      scenario: undefined,
      messages: undefined,
      effort: undefined,
    }
  }

  let scenario = route.query.scenario as string
  let effort = route.query.effort as string

  if (!['short', 'long', 'reasoning'].includes(scenario)) {
    scenario = 'short'
  }

  if (!['off', 'low', 'medium', 'high'].includes(effort)) {
    effort = 'medium'
  }

  return {
    scenario,
    messages: route.query.messages as string || '1',
    effort,
  }
})

const { data: chat, error: chatError } = await useFetch<Chat>(
  () => `/api/v1/chats/${isTestChat.value ? 'test' : route.params.slug}`,
  {
    key,
    cache: 'force-cache',
    query,
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
  reasoning,
  getMessageReasoning,
  isLastUserMessage,
  isLastAssistantMessage,
  shouldDisplayMessage,
  files,
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
