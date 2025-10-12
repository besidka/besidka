<template>
  <LazyBackgroundLogo />
  <ChatInput
    v-model:message="message"
    v-model:tools="tools"
    visible
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

const message = useCookie<string>('chat_input', {
  default: () => '',
})
const tools = shallowRef<Tools>([])
const pending = shallowRef<boolean>(false)

async function onSubmit() {
  pending.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        message: message.value,
        tools: tools.value,
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
