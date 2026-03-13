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
    display-project-picker
    :project-context="projectContext"
    :messages-container="null"
    :messages-length="0"
    visible-on-scroll
    :pending="pending"
    :stop="() => {}"
    :regenerate="() => {}"
    @clear-project-context="clearProject"
    @open-project-picker="openProjectPicker"
    @submit="onSubmit"
  />

  <LazyChatInputProjectPicker
    ref="projectPickerRef"
    @submit="onProjectPickerSubmit"
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
const router = useRouter()
const message = useLocalStorage<string>('chat_input', '')
const files = ref<FileMetadata[]>([])
const tools = shallowRef<Tools>([])
const pending = shallowRef<boolean>(false)
const reasoning = useLocalStorage<ReasoningLevel>(
  'settings_reasoning_level',
  'off',
)

function parseRouteProjectId(projectId: unknown): string | null {
  return typeof projectId === 'string' && projectId.length > 0
    ? projectId
    : null
}

const routeProjectId = computed<string | null>(() => {
  return parseRouteProjectId(route.query.projectId)
})

const projectId = shallowRef<string | null>(routeProjectId.value)
const projectContext = useState<{ id: string, name: string } | null>(
  'chats-new:project-context',
  () => null,
)

if (!projectId.value) {
  projectContext.value = null
} else if (projectContext.value?.id !== projectId.value) {
  projectContext.value = {
    id: projectId.value,
    name: 'Project',
  }
}

reasoning.value = normalizeReasoningLevel(reasoning.value)

interface ProjectPickerInstance {
  open: (projectId: string | null) => void
  close: () => void
}

const projectPickerRef = shallowRef<ProjectPickerInstance | null>(null)

function updateProjectQuery(
  nextProjectId: string | null,
) {
  if (import.meta.server) {
    return
  }

  router.replace({
    query: {
      ...route.query,
      projectId: nextProjectId || undefined,
    },
  })
}

function clearProject() {
  projectId.value = null
  projectContext.value = null

  updateProjectQuery(null)
}

async function fetchProjectContext(nextProjectId: string) {
  return import.meta.server
    ? await useRequestFetch()(`/api/v1/projects/${nextProjectId}`)
    : await $fetch(`/api/v1/projects/${nextProjectId}`)
}

async function syncProjectContext(
  nextProjectId: string | null,
  canApply: () => boolean = () => true,
) {
  if (!nextProjectId) {
    if (canApply()) {
      projectContext.value = null
    }

    return
  }

  if (
    projectContext.value?.id === nextProjectId
    && projectContext.value.name !== 'Project'
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
  } catch (exception) {
    if (!canApply()) {
      return
    }

    const parsedException = parseError(exception)

    if (parsedException.status === 404) {
      clearProject()
    }
  }
}

if (import.meta.server && projectId.value) {
  await syncProjectContext(projectId.value)
}

if (import.meta.client) {
  watch(routeProjectId, (nextProjectId) => {
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

function openProjectPicker() {
  projectPickerRef.value?.open(projectId.value)
}

function onProjectPickerSubmit(payload: {
  projectId: string | null
  projectName: string | null
}) {
  projectId.value = payload.projectId
  projectContext.value = payload.projectId
    ? {
      id: payload.projectId,
      name: payload.projectName || 'Project',
    }
    : null

  updateProjectQuery(payload.projectId)
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
        ...(projectId.value ? { projectId: projectId.value } : {}),
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
