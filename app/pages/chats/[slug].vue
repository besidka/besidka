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
        <ChatMessage
          :role="m.role"
          :message-id="m.id"
          @branch="branchFromMessage"
        >
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
    display-folder-picker
    :folder-context="folderContext"
    :messages-length="chatSdk.messages.length"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    :display-regenerate="displayRegenerate"
    :display-stop="displayStop"
    :status="chatSdk.status"
    @clear-folder-context="clearFolderContext"
    @open-folder-picker="openFolderPicker"
    @submit="submit"
  />

  <LazyChatInputFolderPicker
    ref="folderPickerRef"
    @submit="onFolderPickerSubmit"
  />
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

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

  if (!['low', 'medium', 'high', 'off'].includes(effort)) {
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

const folderId = shallowRef<string | null>(chat.value.folderId ?? null)
const folderContext = shallowRef<{ id: string, name: string } | null>(
  folderId.value
    ? {
      id: folderId.value,
      name: 'Folder',
    }
    : null,
)

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

interface FolderPickerInstance {
  open: (folderId: string | null) => void
}

const folderPickerRef = shallowRef<FolderPickerInstance | null>(null)

async function fetchFolderContext(nextFolderId: string) {
  return import.meta.server
    ? await useRequestFetch()(`/api/v1/folders/${nextFolderId}`)
    : await $fetch(`/api/v1/folders/${nextFolderId}`)
}

async function syncFolderContext(
  nextFolderId: string | null,
  canApply: () => boolean = () => true,
) {
  if (!nextFolderId) {
    if (canApply()) {
      folderContext.value = null
    }

    return
  }

  if (
    folderContext.value?.id === nextFolderId
    && folderContext.value.name !== 'Folder'
  ) {
    return
  }

  if (canApply()) {
    folderContext.value = {
      id: nextFolderId,
      name: 'Folder',
    }
  }

  try {
    const folder = await fetchFolderContext(nextFolderId)

    if (!canApply()) {
      return
    }

    folderContext.value = {
      id: folder.id,
      name: folder.name,
    }
  } catch (exception) {
    if (!canApply()) {
      return
    }

    const parsedException = parseError(exception)

    if (parsedException.status === 404) {
      folderId.value = null
      folderContext.value = null
    }
  }
}

if (import.meta.server && folderId.value) {
  await syncFolderContext(folderId.value)
}

if (import.meta.client) {
  watch(() => {
    return chat.value?.folderId ?? null
  }, (nextFolderId) => {
    if (folderId.value === nextFolderId) {
      return
    }

    folderId.value = nextFolderId
  }, { immediate: true })

  watch(folderId, async (nextFolderId, _previousFolderId, onCleanup) => {
    let isStale = false

    onCleanup(() => {
      isStale = true
    })

    await syncFolderContext(nextFolderId, () => {
      return !isStale && folderId.value === nextFolderId
    })
  }, { immediate: true })
}

onMounted(() => {
  hideMessages.value = false

  nuxtApp.callHook('chat:rendered', scrollContainerRef)
})

const { spacerHeight, waitingForDimensions } = useChatScrollSpacer({
  scrollContainerRef,
  messagesEndRef,
  messagesDomRefs,
  chatSdk,
})

function openFolderPicker() {
  folderPickerRef.value?.open(folderId.value)
}

async function onFolderPickerSubmit(payload: {
  folderId: string | null
  folderName: string | null
}) {
  try {
    await $fetch(`/api/v1/chats/${route.params.slug}/folder`, {
      method: 'PATCH',
      body: { folderId: payload.folderId },
    })

    folderId.value = payload.folderId
    folderContext.value = payload.folderId
      ? {
        id: payload.folderId,
        name: payload.folderName || 'Folder',
      }
      : null

    useSuccessMessage(
      payload.folderId ? 'Moved to folder' : 'Removed from folder',
    )
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to move chat',
      parsedException.why,
    )
  }
}

async function clearFolderContext() {
  await onFolderPickerSubmit({
    folderId: null,
    folderName: null,
  })
}

const branchPending = shallowRef(false)

async function branchFromMessage(messageId: string) {
  branchPending.value = true

  try {
    const response = await $fetch('/api/v1/chats/branch', {
      method: 'post',
      body: {
        chatSlug: route.params.slug,
        messageId,
      },
    })

    navigateTo(`/chats/${response.slug}`)
  } catch (exception: any) {
    useErrorMessage(
      exception.data?.statusMessage
      || exception.statusMessage
      || 'An error occurred while branching.',
    )
  } finally {
    branchPending.value = false
  }
}
</script>
