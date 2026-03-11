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
    display-folder-picker
    :folder-context="folderContext"
    :messages-container="null"
    :messages-length="0"
    visible-on-scroll
    :pending="pending"
    :stop="() => {}"
    :regenerate="() => {}"
    @clear-folder-context="clearFolder"
    @open-folder-picker="openFolderPicker"
    @submit="onSubmit"
  />

  <LazyChatInputFolderPicker
    ref="folderPickerRef"
    @submit="onFolderPickerSubmit"
  />
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
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

const route = useRoute()
const message = useLocalStorage<string>('chat_input', '')
const files = ref<FileMetadata[]>([])
const tools = shallowRef<Tools>([])
const pending = shallowRef<boolean>(false)
const reasoning = useLocalStorage<ReasoningLevel>(
  'settings_reasoning_level',
  'off',
)
const folderId = shallowRef<string | null>(
  (route.query.folderId as string) || null,
)
const folderName = shallowRef<string>(
  (route.query.folderName as string) || '',
)
const folderContext = shallowRef<{ id: string, name: string } | null>(
  folderId.value
    ? {
      id: folderId.value,
      name: folderName.value || 'Folder',
    }
    : null,
)

reasoning.value = normalizeReasoningLevel(reasoning.value)

interface FolderPickerInstance {
  open: (folderId: string | null) => void
  close: () => void
}

const folderPickerRef = shallowRef<FolderPickerInstance | null>(null)

function clearFolder() {
  folderId.value = null
  folderName.value = ''
  folderContext.value = null
}

watch(folderId, async (nextFolderId) => {
  if (!nextFolderId) {
    folderContext.value = null

    return
  }

  folderContext.value = {
    id: nextFolderId,
    name: folderName.value || 'Folder',
  }

  try {
    const folder = await $fetch(`/api/v1/folders/${nextFolderId}`)

    folderName.value = folder.name
    folderContext.value = {
      id: folder.id,
      name: folder.name,
    }
  } catch (exception) {
    const parsedException = parseError(exception)

    if (parsedException.status === 404) {
      clearFolder()
    }
  }
}, { immediate: true })

function openFolderPicker() {
  folderPickerRef.value?.open(folderId.value)
}

function onFolderPickerSubmit(payload: {
  folderId: string | null
  folderName: string | null
}) {
  folderId.value = payload.folderId
  folderName.value = payload.folderName || ''
  folderContext.value = payload.folderId
    ? {
      id: payload.folderId,
      name: payload.folderName || 'Folder',
    }
    : null
}

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
        ...(folderId.value ? { folderId: folderId.value } : {}),
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
