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
      <ChatProjectInstructions
        v-if="projectInstructionsText || projectMemoryText"
        :project-id="projectContext?.id || null"
        :project-name="projectContext?.name || 'Project'"
        :instructions="projectInstructionsText"
        :memory="projectMemoryText"
      />
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
          relative
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
          :is-selected="selectedMessageId === m.id"
          :any-selected="selectedMessageId !== null"
          @select="onMessageSelect"
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
    display-project-picker
    :project-context="projectContext"
    :messages-length="chatSdk.messages.length"
    :stopped="isStopped"
    :stop="stop"
    :regenerate="regenerate"
    :display-regenerate="displayRegenerate"
    :display-stop="displayStop"
    :status="chatSdk.status"
    :any-messages-selected="selectedMessageId !== null"
    @clear-project-context="clearProjectContext"
    @open-project-picker="openProjectPicker"
    @submit="submit"
  />

  <LazyChatInputProjectPicker
    ref="projectPickerRef"
    @submit="onProjectPickerSubmit"
  />

  <ClientOnly>
    <LazyChatContextMenu
      v-if="selectedMessageId"
      :message-id="selectedMessageId"
      :anchor-el="selectedAnchorEl"
      @branch="branchFromMessage"
      @close="clearMessageSelection"
    />
  </ClientOnly>
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

const projectId = shallowRef<string | null>(chat.value.projectId ?? null)
const projectContext = shallowRef<{ id: string, name: string } | null>(
  projectId.value
    ? {
      id: projectId.value,
      name: 'Project',
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

interface ProjectPickerInstance {
  open: (projectId: string | null) => void
}

interface ProjectDetails {
  id: string
  name: string
  instructions: string | null
  memory: string | null
  memoryStatus: 'idle' | 'stale' | 'refreshing' | 'ready' | 'failed' | 'unavailable' | 'disabled'
}

const projectPickerRef = shallowRef<ProjectPickerInstance | null>(null)
const projectInstructions = shallowRef<string | null | undefined>(undefined)
const projectMemory = shallowRef<string | null>(null)
const projectMemoryStatus = shallowRef<ProjectDetails['memoryStatus']>('idle')

const projectInstructionsText = computed(() => {
  const instructions = projectInstructions.value?.trim()

  return instructions || null
})

const projectMemoryText = computed(() => {
  if (projectMemoryStatus.value !== 'ready') {
    return null
  }

  const memory = projectMemory.value?.trim()

  return memory || null
})

async function fetchProjectContext(nextProjectId: string) {
  return import.meta.server
    ? await useRequestFetch()(`/api/v1/projects/${nextProjectId}`)
    : await $fetch(`/api/v1/projects/${nextProjectId}`)
}

async function syncProjectContext(
  nextProjectId: string | null,
  canApply: () => boolean = () => true,
  forceRefresh = false,
) {
  if (!nextProjectId) {
    if (canApply()) {
      projectContext.value = null
      projectInstructions.value = null
      projectMemory.value = null
      projectMemoryStatus.value = 'idle'
    }

    return
  }

  if (
    !forceRefresh
    && projectContext.value?.id === nextProjectId
    && projectContext.value.name !== 'Project'
    && projectInstructions.value !== undefined
  ) {
    return
  }

  if (canApply()) {
    projectContext.value = {
      id: nextProjectId,
      name: 'Project',
    }
  }

  try {
    const project = await fetchProjectContext(nextProjectId)

    if (!canApply()) {
      return
    }

    projectContext.value = {
      id: project.id,
      name: project.name,
    }
    projectInstructions.value = (project as ProjectDetails).instructions ?? null
    projectMemory.value = (project as ProjectDetails).memory ?? null
    projectMemoryStatus.value = (
      project as ProjectDetails
    ).memoryStatus ?? 'idle'
  } catch (exception) {
    if (!canApply()) {
      return
    }

    const parsedException = parseError(exception)

    if (parsedException.status === 404) {
      projectId.value = null
      projectContext.value = null
      projectInstructions.value = null
      projectMemory.value = null
      projectMemoryStatus.value = 'idle'
    }
  }
}

if (import.meta.server && projectId.value) {
  await syncProjectContext(projectId.value)
}

if (import.meta.client) {
  watch(() => {
    return chat.value?.projectId ?? null
  }, (nextProjectId) => {
    if (projectId.value === nextProjectId) {
      return
    }

    projectId.value = nextProjectId
  }, { immediate: true })

  watch(projectId, async (nextProjectId, _previousProjectId, onCleanup) => {
    let isStale = false

    onCleanup(() => {
      isStale = true
    })

    await syncProjectContext(nextProjectId, () => {
      return !isStale && projectId.value === nextProjectId
    })
  }, { immediate: true })
}

onMounted(() => {
  hideMessages.value = false

  nuxtApp.callHook('chat:rendered', scrollContainerRef)
})

if (import.meta.client) {
  watch(() => chatSdk.status, async (nextStatus, previousStatus) => {
    if (
      !projectId.value
      || nextStatus !== 'ready'
      || !['submitted', 'streaming'].includes(previousStatus)
    ) {
      return
    }

    try {
      await $fetch(`/api/v1/chats/${route.params.slug}/project-context/refresh`, {
        method: 'POST',
      })

      await syncProjectContext(projectId.value, () => true, true)
    } catch (exception) {
      void exception
    }
  })
}

const { spacerHeight, waitingForDimensions } = useChatScrollSpacer({
  scrollContainerRef,
  messagesEndRef,
  messagesDomRefs,
  chatSdk,
})

function openProjectPicker() {
  projectPickerRef.value?.open(projectId.value)
}

async function onProjectPickerSubmit(payload: {
  projectId: string | null
  projectName: string | null
}) {
  if (payload.projectId === projectId.value) {
    return
  }

  try {
    await $fetch(`/api/v1/chats/${route.params.slug}/project`, {
      method: 'PATCH',
      body: { projectId: payload.projectId },
    })

    projectId.value = payload.projectId
    projectContext.value = payload.projectId
      ? {
        id: payload.projectId,
        name: payload.projectName || 'Project',
      }
      : null
    projectInstructions.value = payload.projectId
      ? undefined
      : null
    projectMemory.value = null
    projectMemoryStatus.value = payload.projectId ? 'stale' : 'idle'

    useSuccessMessage(
      payload.projectId
        ? 'Moved to project. Future messages will use this project context.'
        : 'Removed from project. Future messages will not use project context.',
    )
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to move chat',
      parsedException.why,
    )
  }
}

async function clearProjectContext() {
  await onProjectPickerSubmit({
    projectId: null,
    projectName: null,
  })
}

const selectedMessageId = shallowRef<string | null>(null)
const selectedAnchorEl = shallowRef<HTMLElement | null>(null)

function onMessageSelect(messageId: string) {
  selectedMessageId.value = messageId

  nuxtApp.callHook('chat:message-selected', messageId)

  const messageIndex = chatSdk.messages.findIndex(m => m.id === messageId)

  selectedAnchorEl.value = messagesDomRefs.value?.[messageIndex] ?? null
}

function clearMessageSelection() {
  selectedMessageId.value = null
  selectedAnchorEl.value = null

  nuxtApp.callHook('chat:message-selected', null)
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
