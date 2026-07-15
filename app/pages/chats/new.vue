<template>
  <ChatContainer>
    <ChatProjectInstructions
      v-if="projectInstructionsText || projectMemoryText"
      :project-id="projectContext?.id || null"
      :project-name="projectContext?.name || 'Project'"
      :instructions="projectInstructionsText"
      :memory="projectMemoryText"
    />
    <ChatMessage
      v-if="!pendingClarification && !isClarifying && !startingResearchJob"
      role="assistant"
      :hide-assistant-avatar-on-mobile="false"
    >
      How can I assist you today?
    </ChatMessage>
    <LazyBackgroundLogo />
    <ChatMessage
      v-if="pendingClarification || isClarifying || startingResearchJob"
      role="user"
      data-testid="research-clarify-topic"
    >
      <p class="chat-markdown">
        {{ pendingResearchQuery }}
      </p>
    </ChatMessage>
    <ChatDeepResearchClarify
      v-if="pendingClarification || isClarifying"
      :clarification="pendingClarification"
      :loading="isClarifying"
      @submit="submitResearchClarification"
      @skip="() => submitResearchClarification([])"
    />
    <ChatDeepResearchPending
      v-if="startingResearchJob"
      :job="startingResearchJob"
      :elapsed-ms="0"
    />
    <div ref="messagesEndRef" />
  </ChatContainer>
  <div
    v-if="pendingClarification || isClarifying || startingResearchJob"
    data-testid="clarify-input-spacer"
    :style="{
      height: `${clarifyInputHeight + INITIAL_SPACER_PADDING}px`,
    }"
  />
  <ChatInput
    v-model:message="message"
    v-model:files="files"
    v-model:tools="tools"
    v-model:reasoning="reasoning"
    display-project-picker
    :project-context="projectContext"
    :messages-length="0"
    :is-clarifying="isClarifying"
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
import type {
  ResearchAnswer,
  ResearchClarificationResponse,
  ResearchJobView,
} from '#shared/types/research.d'

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
const auth = useAuth()
const prefStorage = usePreferenceStorage()
const nuxtApp = useNuxtApp()
const { userModel } = useUserModel()
const message = customRef<string>((track, trigger) => ({
  get() {
    track()

    return prefStorage.getItem('chat_input') ?? ''
  },
  set(value) {
    prefStorage.setItem('chat_input', value)
    trigger()
  },
}))
const files = ref<FileMetadata[]>([])
const tools = shallowRef<Tools>([])
const pending = shallowRef<boolean>(false)
const isClarifying = shallowRef<boolean>(false)
const isCreatingResearchChat = shallowRef<boolean>(false)
const pendingClarification = shallowRef<
  ResearchClarificationResponse | null
>(null)
const pendingResearchQuery = shallowRef<string>('')
const clarifyInputHeight = shallowRef<number>(0)
const messagesEndRef = ref<HTMLDivElement | null>(null)

// Issue #1 (round-3): while the research PUT is in flight, render the same
// synthetic pending job used by useChatResearch() on the existing-chat path
// (see buildLocalPendingResearchJob in app/composables/chat-research.ts) so
// there is instant visual feedback instead of 10-15s of dead air before
// navigation. Only meaningful while isCreatingResearchChat is true — the
// user's chosen model is guaranteed to be a research model at that point
// (guarded by isDeepResearchModel() below), but buildLocalPendingResearchJob
// still returns null defensively if that ever stops holding.
const startingResearchAnswers = shallowRef<ResearchAnswer[]>([])

const startingResearchJob = computed<ResearchJobView | null>(() => {
  if (!isCreatingResearchChat.value) {
    return null
  }

  return buildLocalPendingResearchJob(
    userModel.value,
    startingResearchAnswers.value,
  )
})

// new.vue has no chat-scroll-spacer (that composable measures message DOM
// dimensions, and there are no messages here yet) — the fixed ChatInput's own
// reported height is the most direct way to reserve enough room for the
// clarify form's controls to clear it. INITIAL_SPACER_PADDING mirrors the
// margin useChatScrollSpacer()'s reserveSpaceForClarify() adds on the
// existing-chat page, and — unlike the mobile-only spacer this replaced — the
// reservation now applies at every breakpoint, since a long clarify form can
// grow taller than the viewport on desktop too.
nuxtApp.hook('chat-input:height', (height: number) => {
  clarifyInputHeight.value = height
})

if (import.meta.client) {
  watch(
    [pendingClarification, isClarifying, startingResearchJob],
    async ([clarification, clarifying, job]) => {
      if (!clarification && !clarifying && !job) {
        return
      }

      await nextTick()
      messagesEndRef.value?.scrollIntoView({ behavior: 'smooth' })
    },
  )
}

const reasoning = customRef<ReasoningLevel>((track, trigger) => ({
  get() {
    track()

    return (
      prefStorage.getItem('settings_reasoning_level') as ReasoningLevel
    ) ?? 'off'
  },
  set(value) {
    prefStorage.setItem('settings_reasoning_level', value)
    trigger()
  },
}))

function parseRouteProjectId(projectId: unknown): string | null {
  return typeof projectId === 'string' && projectId.length > 0
    ? projectId
    : null
}

const routeProjectId = computed<string | null>(() => {
  return parseRouteProjectId(route.query.projectId)
})

interface ProjectDetails {
  id: string
  name: string
  instructions: string | null
  memory: string | null
  memoryStatus:
    | 'idle'
    | 'stale'
    | 'refreshing'
    | 'ready'
    | 'failed'
    | 'unavailable'
    | 'disabled'
}

const projectId = shallowRef<string | null>(routeProjectId.value)
const projectContext = useState<{ id: string, name: string } | null>(
  'chats-new:project-context',
  () => null,
)
const projectInstructions = useState<string | null | undefined>(
  'chats-new:project-instructions',
  () => undefined,
)
const projectMemory = useState<string | null>(
  'chats-new:project-memory',
  () => null,
)
const projectMemoryStatus = useState<ProjectDetails['memoryStatus']>(
  'chats-new:project-memory-status',
  () => 'idle',
)

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

if (!projectId.value) {
  projectContext.value = null
  projectInstructions.value = null
  projectMemory.value = null
  projectMemoryStatus.value = 'idle'
} else if (projectContext.value?.id !== projectId.value) {
  projectContext.value = {
    id: projectId.value,
    name: 'Project',
  }
  projectInstructions.value = undefined
  projectMemory.value = null
  projectMemoryStatus.value = 'stale'
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
  projectInstructions.value = null
  projectMemory.value = null
  projectMemoryStatus.value = 'idle'

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
      projectInstructions.value = null
      projectMemory.value = null
      projectMemoryStatus.value = 'idle'
    }

    return
  }

  if (
    projectContext.value?.id === nextProjectId
    && projectContext.value.name !== 'Project'
    && projectInstructions.value !== undefined
  ) {
    return
  }

  if (canApply()) {
    projectContext.value = {
      id: nextProjectId,
      name: projectContext.value?.id === nextProjectId
        ? projectContext.value.name
        : 'Project',
    }
    projectInstructions.value = undefined
    projectMemory.value = null
    projectMemoryStatus.value = 'stale'
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

onMounted(() => {
  // Restore a draft backed up by a previously failed send (e.g. after a
  // /signin redirect or a PWA relaunch), unless the input already has text.
  if (message.value?.trim()) {
    return
  }

  const backup = useChatDraftBackup().peek()

  if (backup) {
    message.value = backup
  }
})

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
  projectInstructions.value = payload.projectId
    ? undefined
    : null
  projectMemory.value = null
  projectMemoryStatus.value = payload.projectId ? 'stale' : 'idle'

  updateProjectQuery(payload.projectId)
}

interface DeferredResearchDraft {
  draft: string
  draftFiles: FileMetadata[]
}

let deferredResearchDraft: DeferredResearchDraft | null = null

async function createResearchChat(
  draft: string,
  draftFiles: FileMetadata[],
  answers: ResearchAnswer[],
): Promise<void> {
  const draftBackup = useChatDraftBackup()

  pending.value = true
  startingResearchAnswers.value = answers
  isCreatingResearchChat.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        parts: [
          {
            type: 'text',
            text: draft,
          } as TextUIPart,
          ...(draftFiles.length
            ? draftFiles.map((file): FileUIPart => ({
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
        model: userModel.value,
        research: {
          answers,
        },
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

    draftBackup.clear()

    if ('researchError' in response && response.researchError) {
      useErrorMessage(
        response.researchError.message
        || 'An error occurred while starting research.',
        response.researchError.why,
      )
    }

    await navigateTo(`/chats/${response.slug}`)
  } catch (exception) {
    draftBackup.save(draft)
    message.value = draft
    files.value = draftFiles
    pendingResearchQuery.value = ''

    const parsedException = parseError(exception)

    if (parsedException.status === 401) {
      await auth.fetchSession({ disableCookieCache: true })

      if (!auth.session.value) {
        await navigateTo('/signin')

        return
      }
    }

    useErrorMessage(
      parsedException.message
      || 'An error occurred while starting research.',
      parsedException.why,
    )
  } finally {
    pending.value = false
    isCreatingResearchChat.value = false
  }
}

function submitResearchClarification(answers: ResearchAnswer[]): void {
  const deferred = deferredResearchDraft

  deferredResearchDraft = null
  // pendingResearchQuery is intentionally kept — the topic bubble and the
  // synthetic pending block below both stay visible for the duration of
  // createResearchChat()'s PUT, instead of the old behavior where clearing
  // it immediately here brought back the "How can I assist you today?"
  // greeting for the 10-15s the request takes to resolve.
  pendingClarification.value = null

  if (!deferred) {
    pendingResearchQuery.value = ''

    useErrorMessage(
      'Failed to start research',
      'Your message could not be recovered. Please try again.',
    )

    return
  }

  createResearchChat(deferred.draft, deferred.draftFiles, answers)
}

// Mirrors useChat()'s requestResearchClarification: on a clarify-fetch
// failure, fall back to starting the research anyway with no answers rather
// than stranding the user on a page that already optimistically cleared
// their draft.
async function requestResearchClarification(
  draft: string,
  draftFiles: FileMetadata[],
): Promise<void> {
  isClarifying.value = true
  pendingResearchQuery.value = draft
  deferredResearchDraft = { draft, draftFiles }

  try {
    const response = await $fetch<ResearchClarificationResponse>(
      '/api/v1/chats/research/clarify',
      {
        method: 'POST',
        body: {
          model: userModel.value,
          topic: draft,
        },
      },
    )

    pendingClarification.value = response
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to prepare research questions',
      parsedException.why,
    )

    submitResearchClarification([])
  } finally {
    isClarifying.value = false
  }
}

async function onSubmit() {
  if (pending.value || isClarifying.value) {
    return
  }

  // ChatInput clears the textarea and attached files optimistically on submit,
  // so snapshot both first — a failed send (e.g. a 401 from a dead session)
  // must never lose what the user typed or attached.
  const draft = message.value
  const draftFiles = [...files.value]
  const draftBackup = useChatDraftBackup()
  const { model } = getModel(userModel.value)

  if (
    isDeepResearchModel(model)
    && !pendingClarification.value
    && draft.trim()
  ) {
    await requestResearchClarification(draft, draftFiles)

    return
  }

  pending.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        parts: [
          {
            type: 'text',
            text: draft,
          } as TextUIPart,
          ...(draftFiles.length
            ? draftFiles.map((file): FileUIPart => ({
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

    draftBackup.clear()
    await navigateTo(`/chats/${response.slug}`)
  } catch (exception) {
    // Back up the draft only on a real failure (a successful send never leaves
    // one behind) and restore the optimistically-cleared input and files.
    draftBackup.save(draft)
    message.value = draft
    files.value = draftFiles

    const parsedException = parseError(exception)

    if (parsedException.status === 401) {
      // Bypass the 5-minute cookie cache: a 401 means the server session is
      // gone, and a cached get-session would mask that and skip the redirect.
      await auth.fetchSession({ disableCookieCache: true })

      if (!auth.session.value) {
        await navigateTo('/signin')

        return
      }
    }

    useErrorMessage(
      parsedException.message
      || 'An error occurred while sending the message.',
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}
</script>
