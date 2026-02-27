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
    v-model:files="files"
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
import type { TextUIPart, FileUIPart } from 'ai'
import type { Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

definePageMeta({
  layout: 'chat',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'New Chat',
})

const message = useLocalStorage<string>('chat_input', '')
const files = ref<FileMetadata[]>([])
const tools = shallowRef<Tools>([])
const pending = shallowRef<boolean>(false)
const reasoning = useLocalStorage<ReasoningLevel>(
  'settings_reasoning_level',
  'off',
)

reasoning.value = normalizeReasoningLevel(reasoning.value)

async function onSubmit() {
  pending.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        parts: [
          {
            type: 'text',
            text: message.value,
          } as TextUIPart,
          ...(files.value.length
            ? files.value.map((file): FileUIPart => ({
              type: 'file',
              mediaType: file.type,
              filename: file.name,
              url: getFileUrl(file.storageKey),
            }))
            : []
          ),
        ] as (TextUIPart | FileUIPart)[],
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
