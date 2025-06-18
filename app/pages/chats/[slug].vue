<template>
  <div
    ref="messagesContainer"
    class="relative overflow-y-auto w-full max-w-4xl mx-auto py-8 px-3 sm:px-24 no-scrollbar outline-none"
    tabindex="-1"
    @scroll="onScroll"
  >
    <div
      v-for="m in messages"
      :key="m.id"
    >
      <div
        v-for="(part, index) in m.parts"
        :key="index"
        class="chat"
        :class="{
          'chat-start': m.role === 'assistant',
          'chat-end': m.role === 'user',
        }"
      >
        <template v-if="part.type === 'text'">
          <template v-if="m.role === 'user'">
            <div
              v-if="session?.user.image"
              class="chat-image avatar rounded-full"
            >
              <div class="w-10 rounded-full">
                <img
                  :alt="session.user.name"
                  :src="session.user.image"
                >
              </div>
            </div>
          </template>
          <template v-else-if="m.role === 'assistant'">
            <div
              v-if="session?.user.image"
              class="max-sm:hidden chat-image avatar avatar-placeholder rounded-full"
            >
              <div class="w-10 rounded-full bg-base-100">
                <Icon name="lucide:bot-message-square" />
              </div>
            </div>
          </template>
          <UiBubble class="chat-bubble !shadow-none">
            <MDCCached
              :value="part.text"
              :cache-key="`message-${m.id}-part-${index}`"
              unwrap="p"
              :components="components"
              :parser-options="{ highlight: false }"
              class="chat-markdown"
            />
          </UiBubble>
        </template>
      </div>
    </div>
    <div
      v-show="showScrollButton && messages.length > 1"
      class="fixed bottom-66 sm:bottom-50 left-1/2 -translate-x-1/2 z-50"
    >
      <UiButton
        circle
        icon-name="lucide:chevrons-down"
        icon-only
        title="New Messages"
        class="opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300"
        @click="scrollToBottom"
      />
    </div>
  </div>
  <LazyChatInput
    v-model="input"
    :pending="pending"
    @submit="onSubmit"
  />
</template>
<script setup lang="ts">
import type { DefineComponent } from 'vue'
import type { Chat } from '#shared/types/chats.d'
import { useChat } from '@ai-sdk/vue'
import { ref, watch, nextTick, onMounted, shallowRef } from 'vue'
import ProseStreamPre from '~/components/prose/PreStream.vue'

const components = {
  pre: ProseStreamPre as unknown as DefineComponent,
}

definePageMeta({
  middleware: 'auth',
  layout: 'chat',
})

useSeoMeta({
  title: 'New Chat',
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

const { data: session } = await useLazyFetch('/api/v1/auth/session')

const userModel = useCookie<string>('model')

const {
  messages, input, handleSubmit, reload, stop: _stop,
} = useChat({
  id: chat.value.id,
  api: `/api/v1/chats/${chat.value.slug}`,
  initialMessages: chat.value.messages?.map(message => ({
    id: message.id,
    content: message.content,
    role: message.role,
  })),
  body: {
    model: userModel.value,
  },
  onFinish() {
    scrollToBottom()
  },
  onError(error) {
    const { message } = typeof error.message === 'string'
      && error.message[0] === '{'
      ? JSON.parse(error.message)
      : error

    useErrorMessage(message)
  },
})

onMounted(() => {
  if (
    chat.value?.messages.length === 1
    || chat.value?.messages.pop()?.role === 'user'
  ) {
    reload()
  }
})

const pending = shallowRef<boolean>(false)

function onSubmit() {
  handleSubmit()
}

const messagesContainer = ref<HTMLElement | null>(null)
const showScrollButton = shallowRef(false)

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTo({
      top: messagesContainer.value.scrollHeight,
      behavior: 'smooth',
    })
    showScrollButton.value = false
  }
}

function onScroll() {
  if (!messagesContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  // If user is not at the bottom, show the button
  showScrollButton.value = scrollTop + clientHeight < scrollHeight - 50
}

watch(
  () => messages.value.length,
  async (newLength, oldLength) => {
    await nextTick()
    if (!messagesContainer.value) return
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
    const atBottom = scrollTop + clientHeight >= scrollHeight - 50
    if (newLength > oldLength) {
      if (atBottom) {
        scrollToBottom()
      } else {
        showScrollButton.value = true
      }
    }
  },
)

onMounted(() => {
  nextTick(scrollToBottom)
})
</script>
