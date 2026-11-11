<template>
  <div
    class="relative size-full min-h-0"
    data-testid="artifact-frame"
    :data-status="status"
  >
    <div
      ref="host"
      class="absolute inset-0"
      :class="{ invisible: !isShowingContent }"
    />
    <div
      v-if="isLoading"
      class="absolute inset-0 flex flex-col gap-3 p-4"
      aria-busy="true"
      data-testid="artifact-frame-loading"
    >
      <span class="sr-only">Loading preview</span>
      <span class="skeleton skeleton--default block h-6 w-1/2" />
      <span class="skeleton skeleton--default block h-4 w-3/4" />
      <span class="skeleton skeleton--default block min-h-0 w-full flex-1" />
    </div>
    <div
      v-else-if="status === 'error'"
      class="absolute inset-0 grid place-items-center p-4"
    >
      <div
        class="alert alert-error alert-soft items-start"
        role="alert"
        data-testid="artifact-frame-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="18"
          class="shrink-0"
        />
        <div class="grow">
          <p class="font-medium">
            {{ errorCopy.title }}
          </p>
          <p class="text-sm">
            {{ errorCopy.description }}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          data-testid="artifact-frame-retry"
          @click="mountFrame"
        >
          Retry
        </button>
      </div>
    </div>
    <div
      v-if="pendingCopy"
      class="absolute inset-x-2 top-2 z-10 flex justify-center"
    >
      <div
        class="alert alert-horizontal w-auto max-w-full gap-2 py-2 pr-2 pl-3 shadow-lg"
        role="alert"
        data-testid="artifact-copy-fallback"
      >
        <Icon
          name="lucide:clipboard"
          size="16"
          class="shrink-0"
        />
        <div class="min-w-0 grow">
          <p class="text-sm">
            Copy from the artifact?
          </p>
          <p
            class="truncate font-mono text-xs text-base-content/70"
            data-testid="artifact-copy-fallback-preview"
          >
            {{ pendingCopyPreview }}
          </p>
          <p
            class="text-xs text-base-content/60"
            data-testid="artifact-copy-fallback-length"
          >
            {{ pendingCopyLength }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            ref="copyFallbackButton"
            type="button"
            class="btn btn-sm btn-primary"
            data-testid="artifact-copy-fallback-copy"
            @click="onConfirmCopyClick"
          >
            Copy
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-circle"
            aria-label="Dismiss"
            data-testid="artifact-copy-fallback-dismiss"
            @click="dismissPendingCopy"
          >
            <Icon
              name="lucide:x"
              size="16"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
    <LazyProseMermaidViewer
      v-if="isViewerOpen"
      v-model:open="isViewerOpen"
      :source="viewerSource"
    />
  </div>
</template>

<script setup lang="ts">
import {
  RUNTIME_DOCUMENT_PATH,
  createHostConnection,
} from '@besidka/artifacts-protocol'
import type {
  ArtifactPayload,
  DisplayMode,
  HostConnection,
  HostContext,
  HostStorageHandlers,
  LogMessageParams,
  OpenLinkParams,
  StorageMode,
  Theme,
  ToolResultContent,
  UnexpectedNavigationDetails,
} from '@besidka/artifacts-protocol'
import { log } from 'evlog/client'
import type {
  ArtifactPanelSource,
  ArtifactRuntimeMessage,
} from '~/composables/artifacts'
import type { ArtifactStorageState } from '~/composables/artifact-storage'
import {
  createArtifactStorageSession,
  resolveArtifactStorageMode,
} from '~/composables/artifact-storage'

type FrameStatus = 'loading' | 'ready' | 'error'

type FrameErrorKind = 'timeout' | 'navigation'

const props = defineProps<{
  title: string
  result: ToolResultContent | null
  partial: ArtifactPayload | null
  artifactId?: string | null
  version?: number | null
  source?: ArtifactPanelSource
}>()

const emit = defineEmits<{
  'ready': []
  'runtime-message': [message: ArtifactRuntimeMessage]
  'storage-change': [state: ArtifactStorageState]
}>()

const LOAD_TIMEOUT_MS = 10_000
const COPY_PREVIEW_MAX_LENGTH = 80
const COPY_KEYBOARD_GUARD_MS = 500
const PARTIAL_THROTTLE_MS = 250
const LINK_ACTION = 'Open link'

const ERROR_COPY: Record<FrameErrorKind, {
  title: string
  description: string
}> = {
  timeout: {
    title: 'The preview did not load',
    description: 'The artifact runtime took too long to start.',
  },
  navigation: {
    title: 'The preview was stopped',
    description: 'The artifact tried to leave its sandbox, so Besidka '
      + 'removed it.',
  },
}

const nuxtApp = useNuxtApp()
const colorMode = useColorMode()
const { loggedIn } = useAuth()
const storageFeature = useFeature('artifacts.storage')
const { isFullWidth } = useSidePanel()
const layout = useSidePanelLayout()
const runtimeOrigin = String(useRuntimeConfig().public.artifactsOrigin ?? '')
  .replace(/\/+$/, '')

const host = useTemplateRef<HTMLDivElement>('host')
const status = shallowRef<FrameStatus>('loading')
const errorKind = shallowRef<FrameErrorKind>('timeout')

let frame: HTMLIFrameElement | null = null
let connection: HostConnection | null = null
let loadTimer: ReturnType<typeof setTimeout> | null = null
let partialTimer: ReturnType<typeof setTimeout> | null = null
let lastPartialAt = 0
let lastSentResult: ToolResultContent | null = null
let pendingCopyShownAt = 0
let storageMode: StorageMode = 'memory'
let storageArtifactId: string | null = null

const theme = computed<Theme>(() => {
  return colorMode.value === 'dark' ? 'dark' : 'light'
})

const displayMode = computed<DisplayMode>(() => {
  if (layout.value === 'sheet') {
    return 'fullscreen'
  }

  return layout.value === 'docked' && isFullWidth.value
    ? 'fullscreen'
    : 'panel'
})

const hasContent = computed<boolean>(() => {
  return !!props.result || !!props.partial
})

const isShowingContent = computed<boolean>(() => {
  return status.value === 'ready' && hasContent.value
})

const isLoading = computed<boolean>(() => {
  return status.value === 'loading'
    || (status.value === 'ready' && !hasContent.value)
})

const {
  handlers: hostActionHandlers,
  pendingCopy,
  isViewerOpen,
  viewerSource,
  confirmPendingCopy,
  dismissPendingCopy,
} = useArtifactHostActions({ layout, displayMode })

const copyFallbackButton = useTemplateRef<HTMLButtonElement>(
  'copyFallbackButton',
)

const pendingCopyPreview = computed<string>(() => {
  const firstLine = pendingCopy.value?.text.split('\n')[0] ?? ''
  const characters = [...firstLine]

  return characters.length > COPY_PREVIEW_MAX_LENGTH
    ? `${characters.slice(0, COPY_PREVIEW_MAX_LENGTH - 1).join('')}…`
    : firstLine
})

const pendingCopyLength = computed<string>(() => {
  const length = [...pendingCopy.value?.text ?? ''].length

  return length === 1 ? '1 character' : `${length} characters`
})

const errorCopy = computed(() => {
  return ERROR_COPY[errorKind.value]
})

const desiredStorageMode = computed<StorageMode>(() => {
  return resolveArtifactStorageMode({
    loggedIn: loggedIn.value,
    featureActive: storageFeature.value.active,
    source: props.source ?? 'owner',
    artifactId: props.artifactId,
  })
})

function toPlainPayload(payload: ArtifactPayload): ArtifactPayload {
  return {
    kind: payload.kind,
    title: payload.title,
    content: payload.content,
  }
}

function toPlainResult(result: ToolResultContent): ToolResultContent {
  return {
    ...toPlainPayload(result),
    ...(result.artifactId ? { artifactId: result.artifactId } : {}),
    ...(result.version ? { version: result.version } : {}),
  }
}

function isSameResult(
  left: ToolResultContent | null,
  right: ToolResultContent,
): boolean {
  return !!left
    && left.artifactId === right.artifactId
    && left.version === right.version
    && left.kind === right.kind
    && left.title === right.title
    && left.content === right.content
}

function sendResult(result: ToolResultContent) {
  if (!connection || isSameResult(lastSentResult, result)) {
    return
  }

  lastSentResult = toPlainResult(result)
  connection.sendToolResult(lastSentResult)
}

function getHostContext(): HostContext {
  return {
    theme: theme.value,
    displayMode: displayMode.value,
    locale: navigator.language || 'en',
    capabilities: { storage: storageMode, complete: false },
  }
}

function clearTimers() {
  if (loadTimer) {
    clearTimeout(loadTimer)
  }

  if (partialTimer) {
    clearTimeout(partialTimer)
  }

  loadTimer = null
  partialTimer = null
}

function teardown() {
  dismissPendingCopy()
  clearTimers()
  connection?.destroy()
  frame?.remove()
  connection = null
  frame = null
  lastSentResult = null
}

function fail(kind: FrameErrorKind) {
  teardown()
  errorKind.value = kind
  status.value = 'error'
}

function onReady() {
  if (loadTimer) {
    clearTimeout(loadTimer)
  }

  loadTimer = null
  status.value = 'ready'
  emit('ready')
}

function onMessage(params: LogMessageParams) {
  emit('runtime-message', {
    level: params.level,
    message: params.data.message,
    stack: params.data.stack,
  })
}

async function onOpenLink({ url }: OpenLinkParams) {
  const result = await nuxtApp.runWithContext(() => {
    return useConfirm({
      text: 'Open this link?',
      subtitle: url,
      actions: [LINK_ACTION],
      labelDecline: 'Cancel',
    })
  })

  if (result?.label !== LINK_ACTION) {
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function onUnexpectedNavigation(details: UnexpectedNavigationDetails) {
  frame = null
  connection = null
  fail('navigation')
  log.warn({
    action: 'artifact-frame-navigation',
    attributes: {
      artifacts: {
        runtimeNavigation: true,
        artifactId: props.artifactId ?? null,
        version: props.version ?? null,
        loadCount: details.loadCount,
      },
    },
  })
}

function sendCurrentContent() {
  if (!connection) {
    return
  }

  if (props.result) {
    sendResult(props.result)

    return
  }

  if (props.partial) {
    lastPartialAt = Date.now()
    connection.sendToolInputPartial(toPlainPayload(props.partial))
  }
}

function createStorageHandlers(): HostStorageHandlers | undefined {
  storageMode = desiredStorageMode.value
  storageArtifactId = props.artifactId ?? null

  if (storageMode !== 'persistent' || !props.artifactId) {
    emit('storage-change', { persistent: false, keys: 0, bytes: 0 })

    return undefined
  }

  const session = createArtifactStorageSession({
    artifactId: props.artifactId,
    onChange: (state) => {
      emit('storage-change', state)
    },
  })

  session.ready().catch(() => {})

  return session.handlers
}

function mountFrame() {
  const container = host.value

  if (!container) {
    return
  }

  teardown()
  status.value = 'loading'
  ensureArtifactFramePolicy(runtimeOrigin)

  const storage = createStorageHandlers()

  const element = document.createElement('iframe')

  element.src = `${runtimeOrigin}${RUNTIME_DOCUMENT_PATH}`
  element.setAttribute('sandbox', 'allow-scripts')
  element.setAttribute('referrerpolicy', 'no-referrer')
  element.setAttribute('allow', '')
  element.setAttribute('data-testid', 'artifact-frame-iframe')
  element.title = `${props.title} preview`
  element.className = 'js-artifact-frame block size-full border-0'

  connection = createHostConnection(element, {
    getHostContext,
    onReady,
    onMessage,
    onOpenLink,
    onUnexpectedNavigation,
    ...hostActionHandlers,
    ...(storage ? { storage } : {}),
  }, {
    hasUserActivation: () => {
      return navigator.userActivation?.isActive === true
        && document.activeElement === element
    },
  })
  frame = element
  container.appendChild(element)
  sendCurrentContent()
  loadTimer = setTimeout(() => {
    loadTimer = null

    if (status.value === 'loading') {
      fail('timeout')
    }
  }, LOAD_TIMEOUT_MS)
}

function flushPartial() {
  partialTimer = null

  if (!connection || !props.partial || props.result) {
    return
  }

  lastPartialAt = Date.now()
  connection.sendToolInputPartial(toPlainPayload(props.partial))
}

function schedulePartial() {
  if (partialTimer) {
    return
  }

  const elapsed = Date.now() - lastPartialAt

  if (elapsed >= PARTIAL_THROTTLE_MS) {
    flushPartial()

    return
  }

  partialTimer = setTimeout(flushPartial, PARTIAL_THROTTLE_MS - elapsed)
}

watch(() => props.result, (result) => {
  if (result && isSameResult(lastSentResult, result)) {
    return
  }

  dismissPendingCopy()

  if (!result || !connection) {
    return
  }

  if (partialTimer) {
    clearTimeout(partialTimer)
    partialTimer = null
  }

  sendResult(result)
})

watch(() => props.partial, (partial) => {
  if (!partial || props.result) {
    return
  }

  schedulePartial()
})

watch([desiredStorageMode, () => props.artifactId], ([mode, artifactId]) => {
  const sessionChanged = mode !== storageMode
    || (mode === 'persistent' && (artifactId ?? null) !== storageArtifactId)

  if (sessionChanged && frame) {
    mountFrame()
  }
})

watch(theme, (value) => {
  connection?.setHostContext({ theme: value })
})

watch(displayMode, (value) => {
  connection?.setHostContext({ displayMode: value })
})

function onConfirmCopyClick(event: MouseEvent) {
  const isKeyboardClick = event.detail === 0
  const elapsed = Date.now() - pendingCopyShownAt

  if (isKeyboardClick && elapsed < COPY_KEYBOARD_GUARD_MS) {
    return
  }

  confirmPendingCopy()
}

watch(pendingCopy, async (pending) => {
  if (!pending) {
    return
  }

  pendingCopyShownAt = Date.now()

  const isFrameFocused = !!frame && document.activeElement === frame

  await nextTick()

  if (isFrameFocused) {
    copyFallbackButton.value?.focus()
  }
})

watch(() => props.title, (title) => {
  if (frame) {
    frame.title = `${title} preview`
  }
})

onMounted(mountFrame)

onBeforeUnmount(teardown)
</script>
