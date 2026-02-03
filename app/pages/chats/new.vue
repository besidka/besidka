<template>
  <ChatContainer>
    <ChatMessage
      role="assistant"
      :hide-assistant-avatar-on-mobile="false"
    >
      How can I assist you today?
    </ChatMessage>
    <LazyBackgroundLogo />
  </ChatContainer>
  <ChatInput
    v-model:message="message"
    v-model:tools="tools"
    v-model:reasoning="reasoning"
    :messages-container="null"
    :messages-length="0"
    visible-on-scroll
    :pending="pending"
    :stop="() => {}"
    :regenerate="() => {}"
    @submit="onSubmit"
  />
</template>
<script setup lang="ts">
import type { Tools } from '#shared/types/chats.d'

definePageMeta({
  layout: 'chat',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'New Chat',
})

const message = useLocalStorage<string>('chat_input', '', {
  shallow: true,
})
const tools = useLocalStorage<Tools>('chat_tools', [], {
  shallow: true,
})
const reasoning = useLocalStorage<boolean>('chat_reasoning', false, {
  shallow: true,
})
const pending = shallowRef<boolean>(false)

async function onSubmit() {
  pending.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        message: message.value,
        tools: tools.value,
        reasoning: reasoning.value,
      },
      cache: 'no-cache',
    })

    if (!response?.slug) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create a new chat.',
      })
    }

    navigateTo(`/chats/${response.slug}`)
  } catch (exception: any) {
    throw createError({
      statusCode: exception.status || 500,
      statusMessage: exception.statusMessage || 'An error occurred while sending the message.',
    })
  } finally {
    pending.value = false
  }
}
</script>
