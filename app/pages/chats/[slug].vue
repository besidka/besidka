<template>
  <div
    ref="messagesContainer"
    class="fixed z-10 inset-0 overflow-y-auto w-full max-w-4xl mx-auto pt-8 px-4 sm:px-24 pb-68 no-scrollbar"
  >

    <!-- Status: <h1>{{ status }}</h1> -->
    <div
      v-for="m in messages"
      :key="m.id"
    >
      <div
        v-for="(part, index) in m.parts"
        :key="index"
      >
        <!-- <h1>{{ part.type }}</h1> -->
        <!-- <template v-if="part.type === 'tool-invocation'">
          State: <strong>{{ part.toolInvocation.state }}</strong>
        </template> -->
        <div
          v-if="part.type === 'text'"
          class="chat"
          :class="{
            'chat-start': m.role === 'assistant',
            'chat-end': m.role === 'user',
          }"
        >
          <div
            class="chat-image avatar rounded-full"
            :class="{
              'avatar-placeholder':
                m.role === 'assistant' || !session?.user.image,
                'max-sm:hidden': m.role === 'assistant',
            }"
          >
            <div class="w-10 rounded-full bg-base-100">
              <Logo
                v-if="m.role === 'assistant'"
                short
                class="size-6 text-text"
              />
              <template v-else>
                <img
                  v-if="session?.user.image"
                  :alt="session.user.name"
                  :src="session.user.image"
                >
                <Icon v-else name="lucide:user-round" />
              </template>
            </div>
          </div>
          <UiBubble class="chat-bubble sm:!px-6 !shadow-none w-full">
            <MDCCached
              :value="m.role === 'user'
                ? $sanitizeHtml(part.text)
                : part.text
              "
              :cache-key="`message-${m.id}-part-${index}`"
              :components="components"
              :parser-options="{ highlight: false }"
              class="chat-markdown"
              :unwrap="getUnwrap(m.role)"
            />
            <LazyChatSources
              v-if="status === 'ready'"
              :message="m"
            />
          </UiBubble>
        </div>
      </div>
    </div>
    <ClientOnly>
      <div
        v-if="status === 'submitted'"
        class="chat chat-start w-fit"
      >
        <div
          class="chat-image avatar avatar-placeholder rounded-full"
        >
          <div class="w-10 rounded-full bg-base-100">
            <Logo
              short
              class="size-6 text-text"
            />
          </div>
        </div>
        <UiBubble class="chat-bubble sm:!px-6 !shadow-none w-full">
          <span class="loading loading-dots loading-md">
            <span class="sr-only">Loading...</span>
          </span>
        </UiBubble>
      </div>

      <div
        v-show="!arrivedState.bottom && messages.length > 1"
        class="fixed z-20 bottom-40 sm:bottom-30 max-sm:right-4 sm:left-1/2 -translate-x-1/2 z-50"
      >
        <UiButton
          circle
          icon-name="lucide:chevrons-down"
          icon-only
          title="Scroll to bottom"
          class="opacity-50 sm:opacity-20 dark:sm:opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 [--depth:0]"
          @click="scrollToBottom"
        />
      </div>
    </ClientOnly>
  </div>
  <LazyChatInput
    v-model:message="input"
    v-model:tools="tools"
    :visible="chatInputVisible"
    :pending="['submitted', 'streaming'].includes(status)"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    @submit="submit"
  />
</template>
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'chat',
})

if (import.meta.server) {
  useSeoMeta({
    title: 'New Chat',
    robots: 'noindex, nofollow',
  })
}

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

useSetChatTitle(chat.value.title)

const { data: session } = await useLazyFetch('/api/v1/auth/session')

const {
  messagesContainer,
  scrollToBottom,
  arrivedState,
} = useChatScroll()

const {
  messages,
  input,
  submit,
  tools,
  status,
  isStopped,
  stop,
  regenerate,
} = useChat(toValue(chat.value))

const { components, getUnwrap } = useChatFormat()

const chatInputVisible = computed(() => {
  return messages.value.length === 1
    || (messages.value.length > 1 && arrivedState.bottom)
})
</script>
