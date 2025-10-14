<template>
  <div class="w-full max-w-4xl mx-auto pt-2 px-4 sm:px-24 pb-72 sm:pb-42">
    <div
      v-for="{
        message: m,
        textParts,
        hasSources: msgHasSources,
      } in messages"
      :key="m.id"
    >
      <div
        v-for="{ part, originalIndex } in textParts"
        :key="`part-${originalIndex}`"
      >
        <div
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
                m.role === 'assistant' || !user?.image,
                'max-sm:hidden': m.role === 'assistant',
            }"
          >
            <div class="w-10 rounded-full bg-base-100 dark:bg-base-content text-text dark:text-base-100">
              <Logo
                v-if="m.role === 'assistant'"
                short
                class="size-6"
              />
              <template v-else>
                <img
                  v-if="user?.image"
                  :alt="user.name"
                  :src="user.image"
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
              :cache-key="`message-${m.id}-part-${originalIndex}`"
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
          </UiBubble>
        </div>
      </div>
    </div>
    <LazyChatLoader v-show="isLoading" />
  </div>
  <ChatInput
    v-model:message="input"
    v-model:tools="tools"
    :messages-length="messagesLength"
    :pending="isLoading"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    :display-regenerate="displayRegenerate"
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

const { user } = useAuth()

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
} = useChat(toValue(chat.value))

const { components, getUnwrap } = useChatFormat()
</script>
