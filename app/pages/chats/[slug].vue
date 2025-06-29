<template>
  <div
    ref="messagesContainer"
    class="fixed z-10 inset-0 overflow-y-auto w-full max-w-4xl mx-auto max-lg:pt-24 lg:pt-16 px-4 sm:px-24 pb-60 no-scrollbar"
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
          <div
            class="chat-image avatar rounded-full"
            :class="{
              'avatar-placeholder':
                m.role === 'assistant' || !session?.user.image,
                'max-sm:hidden': m.role === 'assistant',
            }"
          >
            <div class="w-10 rounded-full bg-base-100">
              <Icon
                v-if="m.role === 'assistant'"
                name="lucide:bot-message-square"
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
              :value="part.text"
              :cache-key="`chat-${chat?.id}-message-${m.id}-part-${index}`"
              :components="components"
              :parser-options="{ highlight: false }"
              class="chat-markdown"
              :unwrap="getUnwrap(m.role)"
            />
          </UiBubble>
        </template>
      </div>
    </div>
    <ClientOnly>
      <div
        v-show="!arrivedState.bottom && messages.length > 1"
        class="fixed z-20 bottom-20 sm:bottom-10 max-sm:right-4 sm:left-1/2 -translate-x-1/2 z-50"
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
    v-model="input"
    :visible="chatInputVisible"
    :pending="pending"
    @submit="onSubmit"
  />
</template>
<script setup lang="ts">
import type { DefineComponent } from 'vue'
import type { Chat } from '#shared/types/chats.d'
import type { Message } from '@ai-sdk/vue'
import { useChat } from '@ai-sdk/vue'
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

const { userModel } = useUserModel()

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
  data: chatTitle,
  error: chatTitleError,
} = await useLazyFetch(
  `/api/v1/chats/${route.params.slug}/title`,
  {
    method: 'patch',
    key: `chat-title-${route.params.slug}`,
    cache: 'force-cache',
    immediate: !chat.value.title,
  },
)

watch(chatTitleError, () => {
  if (!chatTitleError.value) {
    return
  }

  throw createError({
    statusCode: chatTitleError.value.status || 500,
    statusMessage:
      chatTitleError.value.statusMessage
      || 'An error occurred while fetching the chat',
    data: chatError.value,
  })
}, {
  flush: 'post',
  immediate: false,
  once: true,
})

watch(chatTitle, (value) => {
  value && useSeoMeta({
    title: value,
  })
}, {
  flush: 'post',
  immediate: false,
  once: true,
})

const { data: session } = await useLazyFetch('/api/v1/auth/session')

const messagesContainer = ref<HTMLElement | null>(null)

const { measure, y, arrivedState } = useScroll(messagesContainer, {
  behavior: 'smooth',
  offset: {
    bottom: 200,
  },
})

const interval = ref<NodeJS.Timeout | null>(null)

const {
  messages,
  input,
  handleSubmit,
  reload,
  stop: _stop,
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
  onResponse() {
    if (interval.value) {
      return clearInterval(interval.value)
    }

    interval.value = setInterval(scrollToBottom, 1000)
  },
  onFinish() {
    if (interval.value) {
      return clearInterval(interval.value)
    }

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

const chatInputVisible = computed(() => {
  return messages.value.length === 1
    || (messages.value.length > 1 && arrivedState.bottom)
})

onMounted(() => {
  if ((chat.value?.messages?.length || 0) > 1) {
    scrollToBottom()
  } else if (
    chat.value?.messages.length === 1
    || chat.value?.messages.pop()?.role === 'user'
  ) {
    reload()
  }
})

function scrollToBottom() {
  measure()
  y.value += Number.MAX_SAFE_INTEGER
}

const pending = shallowRef<boolean>(false)

function onSubmit() {
  handleSubmit()
}

function getUnwrap(role: Message['role']) {
  const tags = ['strong']

  if (role === 'user') {
    tags.push('pre')
  }

  return tags.join(',')
}
</script>
