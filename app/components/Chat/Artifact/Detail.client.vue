<template>
  <div
    v-if="state"
    class="flex h-full min-h-96 flex-col gap-3 pt-3"
    data-testid="artifact-detail"
    :data-source="state.source"
  >
    <section
      v-if="isShared"
      class="alert alert-soft shrink-0 items-start text-sm"
      aria-label="About this artifact"
      data-testid="artifact-shared-banner"
    >
      <Icon
        name="lucide:sparkles"
        size="16"
        class="mt-0.5 shrink-0"
      />
      <div class="min-w-0 grow">
        <p>{{ SHARED_BANNER_TEXT }}</p>
        <p class="text-base-content/70">
          {{ SHARED_BANNER_WARNING }}
        </p>
      </div>
      <LazyChatArtifactReportButton
        v-if="state.shareSlug && state.artifactId"
        :share-slug="state.shareSlug"
        :artifact-id="state.artifactId"
        :title="displayTitle"
        :version="selectedVersion"
      />
    </section>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <div
        role="tablist"
        aria-label="Artifact view"
        class="tabs tabs-box tabs-sm"
        @keydown.right.prevent="selectTab('code')"
        @keydown.left.prevent="selectTab('preview')"
      >
        <button
          :id="previewTabId"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'preview' }"
          :aria-selected="activeTab === 'preview'"
          :aria-controls="previewPanelId"
          :tabindex="activeTab === 'preview' ? 0 : -1"
          data-testid="artifact-tab-preview"
          @click="selectTab('preview')"
        >
          Preview
        </button>
        <button
          :id="codeTabId"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'code' }"
          :aria-selected="activeTab === 'code'"
          :aria-controls="codePanelId"
          :tabindex="activeTab === 'code' ? 0 : -1"
          data-testid="artifact-tab-code"
          @click="selectTab('code')"
        >
          Code
        </button>
      </div>
      <span class="grow" />
      <div
        v-if="isMermaidCodeTab"
        ref="diagramTheme"
        class="pele-theme flex items-center gap-1"
        data-testid="artifact-mermaid-actions"
      >
        <UiButton
          mode="default"
          ghost
          icon-name="lucide:maximize"
          :icon-size="14"
          size="xs"
          text="Fullscreen"
          icon-only-phone
          :disabled="!mermaidMenuInput.svg"
          data-testid="artifact-mermaid-fullscreen"
          @click="isMermaidViewerOpen = true"
        />
        <ProseMermaidActionMenu
          label="Download"
          icon="lucide:download"
          test-id="artifact-mermaid-download"
          :actions="MERMAID_DOWNLOAD_ACTIONS"
          :input="mermaidMenuInput"
        />
        <ProseMermaidActionMenu
          label="Copy"
          icon="lucide:copy"
          test-id="artifact-mermaid-copy"
          :actions="MERMAID_COPY_ACTIONS"
          :input="mermaidMenuInput"
        />
      </div>
      <span
        v-if="isStreaming"
        class="text-xs text-base-content/60"
        data-testid="artifact-streaming"
      >
        Writing…
      </span>
      <select
        v-else-if="versionOptions.length"
        class="select select-sm w-auto"
        aria-label="Version"
        data-testid="artifact-version-select"
        :value="selectedVersion ?? undefined"
        :disabled="versionOptions.length < 2"
        @change="onVersionChange"
      >
        <option
          v-for="version in versionOptions"
          :key="version"
          :value="version"
        >
          v{{ version }}
        </option>
      </select>
      <details
        ref="actionsMenu"
        class="dropdown dropdown-end"
      >
        <summary
          class="btn btn-sm btn-ghost btn-circle"
          aria-label="Artifact actions"
          title="Artifact actions"
          data-testid="artifact-actions"
        >
          <Icon
            name="lucide:ellipsis"
            size="18"
          />
        </summary>
        <div class="dropdown-content z-50 w-56 pt-2">
          <ul class="menu menu-sm w-full rounded-box bg-base-100 p-1 shadow-lg">
            <li>
              <button
                type="button"
                :disabled="!sourceText"
                data-testid="artifact-action-copy"
                @click="onCopyCode"
              >
                <Icon
                  name="lucide:copy"
                  size="14"
                />
                Copy code
              </button>
            </li>
            <li>
              <button
                type="button"
                :disabled="!content"
                data-testid="artifact-action-download-source"
                @click="onDownloadSource"
              >
                <Icon
                  name="lucide:download"
                  size="14"
                />
                Download source
              </button>
            </li>
            <li v-if="canDownloadHtml">
              <button
                type="button"
                :disabled="!content"
                data-testid="artifact-action-download-html"
                @click="onDownloadHtml"
              >
                <Icon
                  name="lucide:file-code"
                  size="14"
                />
                Download as HTML
              </button>
            </li>
            <li v-if="canShare">
              <button
                type="button"
                data-testid="artifact-action-share"
                @click="onOpenShare"
              >
                <Icon
                  name="lucide:link"
                  size="14"
                />
                Share link
              </button>
            </li>
            <li v-if="canResetStorage">
              <button
                type="button"
                data-testid="artifact-action-reset-storage"
                @click="onResetStorage"
              >
                <Icon
                  name="lucide:rotate-ccw"
                  size="14"
                />
                Reset saved progress
              </button>
            </li>
            <li v-if="layout === 'docked'">
              <button
                type="button"
                data-testid="artifact-action-full-width"
                @click="onToggleFullWidth"
              >
                <Icon
                  :name="isFullWidth
                    ? 'lucide:minimize-2'
                    : 'lucide:maximize-2'"
                  size="14"
                />
                {{ isFullWidth ? 'Exit full width' : 'Full width' }}
              </button>
            </li>
          </ul>
        </div>
      </details>
    </div>
    <div
      v-if="runtimeError"
      class="alert alert-error alert-soft shrink-0 items-start"
      role="alert"
      data-testid="artifact-runtime-error"
    >
      <Icon
        name="lucide:bug"
        size="18"
        class="shrink-0"
      />
      <div class="min-w-0 grow">
        <p class="font-medium">
          The artifact reported an error
        </p>
        <p class="text-sm break-words">
          {{ runtimeError.message }}
        </p>
        <details
          v-if="runtimeError.stack"
          class="mt-1 text-xs"
        >
          <summary class="cursor-pointer">
            Details
          </summary>
          <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{{ runtimeError.stack }}</pre>
        </details>
      </div>
      <button
        v-if="isOwner"
        type="button"
        class="btn btn-sm"
        data-testid="artifact-ask-to-fix"
        @click="onAskToFix"
      >
        Ask to fix
      </button>
    </div>
    <div class="relative min-h-0 flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100">
      <div
        v-if="streamError"
        class="absolute inset-0 z-20 grid place-items-center bg-base-100 p-4"
      >
        <div
          class="alert alert-error alert-soft items-start"
          role="alert"
          data-testid="artifact-stream-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="18"
            class="shrink-0"
          />
          <div class="min-w-0 grow">
            <p class="font-medium">
              Couldn't save this artifact
            </p>
            <p class="text-sm break-words">
              {{ streamError }}
            </p>
          </div>
        </div>
      </div>
      <div
        v-if="loadError"
        class="absolute inset-0 z-10 grid place-items-center bg-base-100 p-4"
      >
        <p
          v-if="isUnavailableError"
          class="text-sm text-base-content/60"
          data-testid="artifact-unavailable"
        >
          Artifact unavailable
        </p>
        <div
          v-else
          class="alert alert-error alert-soft items-start"
          role="alert"
          data-testid="artifact-load-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="18"
            class="shrink-0"
          />
          <div class="grow">
            <p class="font-medium">
              Couldn't load this artifact
            </p>
            <p class="text-sm">
              {{ loadError.message }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm"
            data-testid="artifact-load-retry"
            @click="reloadContent"
          >
            Retry
          </button>
        </div>
      </div>
      <div
        v-show="activeTab === 'preview'"
        :id="previewPanelId"
        role="tabpanel"
        :aria-labelledby="previewTabId"
        class="absolute inset-0"
      >
        <ChatArtifactFrame
          :key="frameKey"
          :title="displayTitle"
          :result="frameResult"
          :partial="framePartial"
          :artifact-id="state.artifactId"
          :version="selectedVersion"
          :source="state.source"
          @runtime-message="onRuntimeMessage"
          @storage-change="onStorageChange"
        />
      </div>
      <div
        v-if="hasOpenedCode"
        v-show="activeTab === 'code'"
        :id="codePanelId"
        role="tabpanel"
        :aria-labelledby="codeTabId"
        class="absolute inset-0 overflow-auto px-3"
        data-testid="artifact-code"
      >
        <div
          v-if="sourceText && isStreaming"
          class="my-3 overflow-x-auto rounded-box border border-base-300 bg-base-100/50 p-4 text-sm"
          data-testid="artifact-code-stream"
        >
          <ProseCodeStream
            :code="sourceText"
            :language="codeLanguage"
            :theme="codeTheme"
          />
        </div>
        <ChatArtifactCodeView
          v-else-if="sourceText"
          :code="sourceText"
          :language="codeLanguage"
          :cache-key="codeCacheKey"
        />
        <UiSidePanelSkeleton v-else />
      </div>
    </div>
    <p
      class="shrink-0 text-center text-xs text-base-content/60"
      data-testid="artifact-ai-note"
    >
      AI-generated content
    </p>
    <LazyProseMermaidViewer
      v-if="isMermaidViewerOpen"
      v-model:open="isMermaidViewerOpen"
      :source="sourceText"
    />
    <LazyChatArtifactShareModal
      v-if="hasOpenedShare && state.artifactId && shareVersion"
      v-model:open="isShareOpen"
      :artifact-id="state.artifactId"
      :title="displayTitle"
      :current-version="shareVersion"
    />
  </div>
</template>

<script setup lang="ts">
import type {
  ArtifactPayload,
  ToolResultContent,
} from '@besidka/artifacts-protocol'
import { parseError } from 'evlog'
import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactVersionContent,
} from '#shared/utils/artifacts'
import type { ArtifactRuntimeMessage } from '~/composables/artifacts'
import type { DiagramMenuInput } from '~/types/diagram-export.d'
import type { ArtifactStorageState } from '~/composables/artifact-storage'
import { resetArtifactStorage } from '~/composables/artifact-storage'
import {
  isArtifactUnavailableStatus,
  loadArtifactDetail,
  loadArtifactVersion,
  useSharedArtifactVersions,
} from '~/composables/artifacts'
import {
  buildArtifactSourceFile,
  buildStandaloneArtifactFile,
  canExportStandaloneHtml,
  downloadArtifactFile,
} from '~/utils/artifact-export'

type ArtifactTab = 'preview' | 'code'

interface LoadError {
  status: number
  message: string
}

const SHARED_BANNER_TEXT
  = 'AI-generated by a Besidka user, not reviewed by Besidka.'
const SHARED_BANNER_WARNING = 'Never enter passwords or payment details here.'
const MAX_RUNTIME_ERRORS = 5
const STREAM_FAILED_TEXT = 'The artifact could not be saved.'
const RESET_STORAGE_ACTION = 'Reset progress'
const PARTIAL_PREVIEW_KINDS = new Set<ArtifactKind>(['html', 'svg', 'markdown'])
const CODE_LANGUAGES: Record<ArtifactKind, string> = {
  html: 'html',
  react: 'jsx',
  svg: 'xml',
  mermaid: 'mermaid',
  markdown: 'markdown',
}

const nuxtApp = useNuxtApp()
const colorMode = useColorMode()
const panel = useArtifactPanel()
const sidePanel = useSidePanel()
const layout = useSidePanelLayout()
const sharedVersions = useSharedArtifactVersions()
const shareFeature = useFeature('artifacts.share')
const clipboard = useClipboard({ legacy: true })
const { state, stream } = panel
const { isFullWidth } = sidePanel

const previewTabId = useId()
const codeTabId = useId()
const previewPanelId = useId()
const codePanelId = useId()
const actionsMenu = useTemplateRef<HTMLDetailsElement>('actionsMenu')

const activeTab = shallowRef<ArtifactTab>('preview')
const hasOpenedCode = shallowRef<boolean>(false)

watch(activeTab, (tab) => {
  if (tab === 'code') {
    hasOpenedCode.value = true
  }
}, { immediate: true })
const isCodeTabForced = shallowRef<boolean>(false)
const detail = shallowRef<ArtifactDetail | null>(null)
const content = shallowRef<ArtifactVersionContent | null>(null)
const loadError = shallowRef<LoadError | null>(null)
const runtimeErrors = shallowRef<ArtifactRuntimeMessage[]>([])
const storageState = shallowRef<ArtifactStorageState>({
  persistent: false,
  keys: 0,
  bytes: 0,
})
const frameKey = shallowRef<number>(0)
const isShareOpen = shallowRef<boolean>(false)
const hasOpenedShare = shallowRef<boolean>(false)

let contentRequestId = 0
let detailRequestId = 0

const isShared = computed<boolean>(() => {
  return state.value?.source === 'shared'
})

const isOwner = computed<boolean>(() => {
  return state.value?.source === 'owner'
})

const liveStream = computed(() => {
  const current = stream.value
  const toolCallId = state.value?.toolCallId

  return current && toolCallId && current.toolCallId === toolCallId
    ? current
    : null
})

const isStreaming = computed<boolean>(() => {
  return liveStream.value?.status === 'streaming'
})

const streamError = computed<string | null>(() => {
  const current = liveStream.value

  if (current?.status !== 'failed') {
    return null
  }

  return current.errorText || STREAM_FAILED_TEXT
})

const kind = computed<ArtifactKind | null>(() => {
  if (isStreaming.value) {
    return liveStream.value?.kind ?? state.value?.kind ?? null
  }

  return content.value?.kind ?? state.value?.kind ?? null
})

const displayTitle = computed<string>(() => {
  return content.value?.title
    || state.value?.title
    || liveStream.value?.title
    || 'Artifact'
})

const selectedVersion = computed<number | null>(() => {
  return state.value?.version ?? detail.value?.currentVersion ?? null
})

const versionOptions = computed<number[]>(() => {
  const artifactId = state.value?.artifactId

  if (!artifactId) {
    return []
  }

  if (isOwner.value) {
    const versions = detail.value?.versions.map((entry) => {
      return entry.version
    }) ?? []
    const merged = new Set<number>(versions)

    if (selectedVersion.value !== null) {
      merged.add(selectedVersion.value)
    }

    return [...merged].sort((left, right) => right - left)
  }

  const referenced = new Set<number>(sharedVersions.value[artifactId] ?? [])

  if (state.value?.version) {
    referenced.add(state.value.version)
  }

  return [...referenced].sort((left, right) => right - left)
})

const sourceText = computed<string>(() => {
  if (isStreaming.value) {
    return liveStream.value?.content ?? ''
  }

  return content.value?.content ?? ''
})

const codeLanguage = computed<string>(() => {
  return kind.value ? CODE_LANGUAGES[kind.value] : 'text'
})

const codeCacheKey = computed<string | null>(() => {
  const value = content.value

  return value ? `${value.artifactId}:${value.version}` : null
})

const isMermaidCodeTab = computed<boolean>(() => {
  return kind.value === 'mermaid'
    && activeTab.value === 'code'
    && !isStreaming.value
    && !!sourceText.value
})

const mermaidSvg = shallowRef<string>('')
const isMermaidViewerOpen = shallowRef<boolean>(false)
const diagramTheme = useTemplateRef<HTMLElement>('diagramTheme')
const mermaidIdPrefix = `artifact-code-mermaid-${useId()}`
const { renderDiagram } = useDiagramRenderer()

const mermaidMenuInput = computed<DiagramMenuInput>(() => {
  return {
    source: sourceText.value,
    svg: mermaidSvg.value,
    themeElement: () => diagramTheme.value,
  }
})

watch([isMermaidCodeTab, sourceText], async (
  [isVisible, source],
  _previous,
  onCleanup,
) => {
  let isStale = false

  onCleanup(() => {
    isStale = true
  })

  if (!isVisible) {
    return
  }

  mermaidSvg.value = ''

  const result = await renderDiagram(source, { idPrefix: mermaidIdPrefix })

  if (isStale || 'error' in result) {
    return
  }

  mermaidSvg.value = sanitizeDiagramSvg(result.svg)
}, { immediate: true })

const codeTheme = computed<string>(() => {
  return colorMode.value === 'dark' ? CODE_THEME_DARK : CODE_THEME_LIGHT
})

const canDownloadHtml = computed<boolean>(() => {
  return !!kind.value && canExportStandaloneHtml(kind.value)
})

const canResetStorage = computed<boolean>(() => {
  return isOwner.value
    && !!state.value?.artifactId
    && storageState.value.persistent
    && storageState.value.keys > 0
})

const shareVersion = computed<number | null>(() => {
  return detail.value?.currentVersion ?? null
})

const canShare = computed<boolean>(() => {
  return isOwner.value
    && shareFeature.value.active
    && !!state.value?.artifactId
    && !!shareVersion.value
    && !isStreaming.value
    && !detail.value?.takenDown
})

const isUnavailableError = computed<boolean>(() => {
  const error = loadError.value

  return !!error && isArtifactUnavailableStatus(error.status)
})

const runtimeError = computed<ArtifactRuntimeMessage | null>(() => {
  return runtimeErrors.value.at(-1) ?? null
})

const framePartial = computed<ArtifactPayload | null>(() => {
  const current = liveStream.value

  if (
    !isStreaming.value
    || !current?.content
    || !current.kind
    || !PARTIAL_PREVIEW_KINDS.has(current.kind)
  ) {
    return null
  }

  return {
    kind: current.kind,
    title: current.title || displayTitle.value,
    content: current.content,
  }
})

const frameResult = computed<ToolResultContent | null>(() => {
  const value = content.value

  if (isStreaming.value || !value) {
    return null
  }

  return {
    kind: value.kind,
    title: value.title,
    content: value.content,
    artifactId: value.artifactId,
    version: value.version,
  }
})

useHead({
  meta: computed(() => {
    return isShared.value ? [{ name: 'ai-generated', content: 'true' }] : []
  }),
})

function selectTab(tab: ArtifactTab) {
  activeTab.value = tab
  isCodeTabForced.value = false
}

function closeActionsMenu() {
  if (actionsMenu.value) {
    actionsMenu.value.open = false
  }
}

async function loadDetail() {
  const artifactId = state.value?.artifactId

  detail.value = null

  if (!artifactId || !isOwner.value) {
    return
  }

  const requestId = ++detailRequestId
  const result = await loadArtifactDetail(artifactId, { notify: false })

  if (requestId !== detailRequestId) {
    return
  }

  if (result.ok) {
    detail.value = result.value

    return
  }

  if (isArtifactUnavailableStatus(result.status)) {
    panel.markUnavailable(artifactId)
    loadError.value = { status: result.status, message: result.message }
  }
}

async function reloadContent() {
  const current = state.value
  const version = selectedVersion.value

  if (!current?.artifactId || version === null || isStreaming.value) {
    return
  }

  const requestId = ++contentRequestId

  loadError.value = null

  const result = await loadArtifactVersion({
    artifactId: current.artifactId,
    version,
    source: current.source,
    shareSlug: current.shareSlug,
  }, { notify: false })

  if (requestId !== contentRequestId) {
    return
  }

  if (result.ok) {
    content.value = result.value
    runtimeErrors.value = []

    return
  }

  loadError.value = { status: result.status, message: result.message }

  if (isArtifactUnavailableStatus(result.status)) {
    panel.markUnavailable(current.artifactId)
  }
}

watch(
  [() => state.value?.artifactId, () => state.value?.source],
  loadDetail,
  { immediate: true },
)

watch(
  [() => state.value?.artifactId, selectedVersion, isStreaming],
  reloadContent,
  { immediate: true },
)

watch(isStreaming, (streaming) => {
  if (streaming) {
    if (kind.value && !PARTIAL_PREVIEW_KINDS.has(kind.value)) {
      activeTab.value = 'code'
      isCodeTabForced.value = true
    }

    return
  }

  if (isCodeTabForced.value) {
    activeTab.value = 'preview'
    isCodeTabForced.value = false
  }
}, { immediate: true })

watch(kind, (value) => {
  if (
    isStreaming.value
    && value
    && !PARTIAL_PREVIEW_KINDS.has(value)
    && activeTab.value === 'preview'
  ) {
    activeTab.value = 'code'
    isCodeTabForced.value = true
  }
})

function onVersionChange(event: Event) {
  const version = Number((event.target as HTMLSelectElement).value)

  if (Number.isSafeInteger(version)) {
    panel.selectVersion(version)
  }
}

function onRuntimeMessage(message: ArtifactRuntimeMessage) {
  if (message.level !== 'error') {
    return
  }

  runtimeErrors.value = [
    ...runtimeErrors.value,
    message,
  ].slice(-MAX_RUNTIME_ERRORS)
}

async function onCopyCode() {
  closeActionsMenu()

  if (!sourceText.value) {
    return
  }

  await clipboard.copy(sourceText.value)
  useSuccessMessage('Code copied')
}

function onDownloadSource() {
  closeActionsMenu()

  const value = content.value

  if (!value) {
    return
  }

  downloadArtifactFile(buildArtifactSourceFile(value.kind, value.content, {
    title: value.title,
  }))
}

function onDownloadHtml() {
  closeActionsMenu()

  const value = content.value

  if (!value || !canExportStandaloneHtml(value.kind)) {
    return
  }

  downloadArtifactFile(buildStandaloneArtifactFile(value.kind, value.content, {
    title: value.title,
  }))
}

function onStorageChange(value: ArtifactStorageState) {
  storageState.value = value
}

async function onResetStorage() {
  closeActionsMenu()

  const artifactId = state.value?.artifactId

  if (!artifactId || !canResetStorage.value) {
    return
  }

  const result = await useConfirm({
    text: 'Reset saved progress?',
    subtitle: `Everything "${displayTitle.value}" saved for you, such as `
      + 'answers and scores, is deleted. This cannot be undone.',
    alert: true,
    actions: [RESET_STORAGE_ACTION],
    labelDecline: 'Cancel',
  })

  if (result?.label !== RESET_STORAGE_ACTION) {
    return
  }

  const reset = resetArtifactStorage(artifactId)

  frameKey.value += 1

  try {
    await reset
    storageState.value = { ...storageState.value, keys: 0, bytes: 0 }
    useSuccessMessage('Saved progress reset')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Could not reset saved progress',
      parsedException.why,
    )
  }
}

function onOpenShare() {
  closeActionsMenu()

  if (!canShare.value) {
    return
  }

  hasOpenedShare.value = true
  isShareOpen.value = true
}

function onToggleFullWidth() {
  closeActionsMenu()
  sidePanel.toggleFullWidth()
}

async function onAskToFix() {
  const error = runtimeError.value

  if (!error || !isOwner.value) {
    return
  }

  const text = buildArtifactFixPrompt(displayTitle.value, error)

  if (layout.value !== 'docked') {
    sidePanel.close()
    await nextTick()
  }

  await nuxtApp.callHook('chat-input:prefill', text)
}
</script>
