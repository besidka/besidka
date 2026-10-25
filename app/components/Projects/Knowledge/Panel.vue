<template>
  <UiBubble
    class="mb-4 !block bg-base-100 dark:bg-base-100/10 shadow-none"
    role="region"
    :aria-labelledby="headingId"
    data-testid="knowledge-panel"
  >
    <div class="min-w-0">
      <h2
        :id="headingId"
        class="text-sm font-semibold"
      >
        Project knowledge
      </h2>
      <p class="mt-1 text-sm opacity-70">
        Files and notes Besidka reads in this project's chats.
      </p>
    </div>

    <div
      v-if="isInitialLoading"
      class="mt-4 grid gap-3"
      data-testid="knowledge-skeleton"
    >
      <div class="skeleton skeleton--default h-4 w-1/2" />
      <div class="skeleton skeleton--default h-2 w-full" />
      <div class="skeleton skeleton--default h-20 w-full" />
    </div>
    <div
      v-else-if="loadError"
      role="alert"
      class="alert alert-soft alert-error mt-4 !items-start"
      data-testid="knowledge-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="20"
        class="mt-0.5 shrink-0"
      />
      <div class="grid min-w-0 flex-1 gap-1">
        <p class="break-words font-bold">
          {{ loadError.message || 'Failed to load project knowledge' }}
        </p>
        <p
          v-if="loadError.why"
          class="break-words text-sm"
        >
          {{ loadError.why }}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="knowledge-retry"
        @click="knowledge.refresh()"
      >
        Try again
      </button>
    </div>
    <div
      v-else
      class="mt-4 grid gap-4"
    >
      <template v-if="hasItems">
        <ProjectsKnowledgeCapacityMeter
          :items="knowledge.items.value"
          :totals="knowledge.totals.value"
          :mode="knowledge.mode.value"
          :model="modelContext"
          :storage-total-bytes="storageStats?.total ?? null"
          :is-ready="isMounted"
        />
        <ProjectsKnowledgeModeSelector
          :model-value="knowledge.mode.value"
          @select="onModeSelect"
        />
        <ProfileMemoryCacheInfo
          :knowledge-tokens="cacheTokens"
          :show-memory-index="false"
          collapsed-after-first-view
        />
      </template>

      <div class="flex flex-wrap items-center gap-2">
        <ProjectsKnowledgeMenu
          label="Add files"
          menu-label="Add files"
          icon-name="lucide:plus"
          trigger-class="btn-primary"
          trigger-test-id="knowledge-add-files"
        >
          <li>
            <button
              type="button"
              :disabled="upload.isBusy.value"
              data-testid="knowledge-upload-files"
              @click="openFilePicker"
            >
              <Icon
                name="lucide:upload"
                size="16"
              />
              Upload files
            </button>
          </li>
          <li>
            <button
              type="button"
              :disabled="upload.isBusy.value"
              data-testid="knowledge-from-library"
              @click="isLibraryOpen = true"
            >
              <Icon
                name="lucide:library"
                size="16"
              />
              From my library
            </button>
          </li>
        </ProjectsKnowledgeMenu>
        <UiButton
          size="sm"
          normal-case
          mode="neutral"
          outline
          icon-name="lucide:notebook-pen"
          text="New note"
          data-testid="knowledge-new-note"
          @click="openNewNote"
        />
        <div class="hidden sm:contents">
          <button
            type="button"
            class="btn btn-sm normal-case btn-ghost btn-ghost-legacy"
            :disabled="upload.isBusy.value"
            data-testid="knowledge-add-folder"
            @click="openFolderPicker"
          >
            <Icon
              name="lucide:folder-plus"
              size="16"
            />
            Add folder
          </button>
          <button
            v-if="canPickDirectory"
            type="button"
            class="btn btn-sm normal-case btn-ghost btn-ghost-legacy"
            :disabled="upload.isBusy.value || isReadingFolder"
            data-testid="knowledge-sync-folder"
            @click="pickSyncedFolder"
          >
            <span
              v-if="isReadingFolder"
              class="loading loading-spinner loading-xs"
            />
            <Icon
              v-else
              name="lucide:folder-sync"
              size="16"
            />
            Sync with a folder
          </button>
        </div>
        <ProjectsKnowledgeMenu
          class="sm:hidden"
          label="More"
          menu-label="More knowledge actions"
          icon-name="lucide:ellipsis"
          trigger-test-id="knowledge-more-trigger"
        >
          <li>
            <button
              type="button"
              :disabled="upload.isBusy.value"
              data-testid="knowledge-add-folder-menu"
              @click="openFolderPicker"
            >
              <Icon
                name="lucide:folder-plus"
                size="16"
              />
              Add folder
            </button>
          </li>
          <li v-if="canPickDirectory">
            <button
              type="button"
              :disabled="upload.isBusy.value || isReadingFolder"
              data-testid="knowledge-sync-folder-menu"
              @click="pickSyncedFolder"
            >
              <Icon
                name="lucide:folder-sync"
                size="16"
              />
              Sync with a folder
            </button>
          </li>
        </ProjectsKnowledgeMenu>
      </div>

      <div
        v-if="isUploadRunningInBackground"
        role="status"
        class="
          alert alert-soft alert-info flex flex-wrap items-center
          justify-between gap-2
        "
        data-testid="knowledge-upload-banner"
      >
        <span>
          Adding files: {{ upload.progress.value.done }}
          of {{ upload.progress.value.total }}
        </span>
        <button
          type="button"
          class="btn btn-sm"
          data-testid="knowledge-upload-show"
          @click="isUploadSheetOpen = true"
        >
          Show progress
        </button>
      </div>

      <p
        v-if="!hasItems && preparingRows.length === 0"
        class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
        data-testid="knowledge-empty"
      >
        No knowledge yet. Add files, a folder or a note.
      </p>
      <ProjectsKnowledgeItemList
        v-else
        :items="knowledge.items.value"
        :token-model="isMounted ? modelContext : null"
        :folder-names="folders.names.value"
        :preparing-rows="preparingRows"
        :syncable-folder-ids="syncableFolderIds"
        :syncing-folder-id="syncingFolderId"
        :removing-id="removingId"
        @edit="openItem"
        @remove="removeWithConfirm"
        @sync="syncFolder"
      />
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      :accept="acceptAttribute"
      data-testid="knowledge-file-input"
      @change="onFilesChosen"
    >
    <input
      ref="folderInput"
      type="file"
      multiple
      webkitdirectory
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      data-testid="knowledge-folder-input"
      @change="onFolderChosen"
    >

    <LazyProjectsKnowledgeUploadSheet
      v-model:open="isUploadSheetOpen"
      :phase="upload.phase.value"
      :plan="upload.plan.value"
      :sync-summary="upload.syncSummary.value"
      :was-cancelled="upload.wasCancelled.value"
      :entries="upload.entries.value"
      :progress="upload.progress.value"
      :error="upload.error.value"
      @start="upload.start()"
      @cancel="onUploadCancel"
      @retry="upload.retryFailed()"
    />
    <LazyProjectsKnowledgeNoteEditor
      v-model:open="isNoteEditorOpen"
      :item="selectedNote"
      :create-note="knowledge.createNote"
      :update-note="knowledge.updateNote"
      :get-item-text="knowledge.getItemText"
    />
    <LazyProjectsKnowledgeItemEditSheet
      v-model:open="isItemSheetOpen"
      :item="selectedFile"
      :tokens="selectedFileTokens"
      :model-name="modelContext.name"
      :can-send-pdf="modelContext.acceptsPdf"
      :patch-item="knowledge.patchItem"
      @remove="removeWithConfirm"
      @readd="replaceItemFile"
    />
    <LazyProjectsKnowledgeLibraryPicker
      v-model:open="isLibraryOpen"
      @select="onLibrarySelect"
    />
  </UiBubble>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  KnowledgeItem,
  KnowledgeMode,
} from '#shared/types/project-knowledge.d'
import {
  knowledgeDocumentExtensions,
  knowledgeImageExtensions,
  knowledgeTextExtensions,
} from '#shared/utils/project-knowledge-policy'
import type {
  KnowledgeLibraryFile,
  KnowledgePreparingRow,
} from '~/types/knowledge-ui.d'
import type {
  KnowledgeUploadSource,
  ProjectKnowledgeError,
} from '~/types/project-knowledge.d'
import type { KnowledgePlanEntry } from '~/utils/knowledge-upload-plan'

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (
    options?: { mode?: 'read' | 'readwrite' },
  ) => Promise<FileSystemDirectoryHandle>
}

const props = defineProps<{
  projectId: string
}>()

const MAX_PREPARING_ROWS = 8
const GITIGNORE_FILE_NAME = '.gitignore'
const PREPARING_STATUSES = ['queued', 'extracting', 'uploading-original']

const headingId = useId()
const acceptAttribute = [
  ...knowledgeTextExtensions,
  ...knowledgeDocumentExtensions,
  ...knowledgeImageExtensions,
].map(extension => `.${extension}`).join(',')

const projectIdRef = toRef(props, 'projectId')
const knowledge = useProjectKnowledge(projectIdRef)
const upload = useKnowledgeUpload(projectIdRef, knowledge)
const folders = useKnowledgeFolderMemory(projectIdRef)
const modelContext = useKnowledgeModelContext()
const { selection } = useSelectedModelInfo()
const { data: storageStats, refresh: refreshStorage } = useLazyFetch(
  '/api/v1/storage',
  { server: false },
)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const folderInput = useTemplateRef<HTMLInputElement>('folderInput')

const isMounted = shallowRef<boolean>(false)
const canPickDirectory = shallowRef<boolean>(false)
const isUploadSheetOpen = shallowRef<boolean>(false)
const isNoteEditorOpen = shallowRef<boolean>(false)
const isItemSheetOpen = shallowRef<boolean>(false)
const isLibraryOpen = shallowRef<boolean>(false)
const isReadingFolder = shallowRef<boolean>(false)
const selectedItemId = shallowRef<string | null>(null)
const removingId = shallowRef<string | null>(null)
const syncingFolderId = shallowRef<string | null>(null)
const itemToReplace = shallowRef<KnowledgeItem | null>(null)

const isInitialLoading = computed<boolean>(() => {
  return knowledge.pending.value && !knowledge.summary.value
})

const loadError = computed<ProjectKnowledgeError | null>(() => {
  if (!knowledge.error.value || knowledge.summary.value) {
    return null
  }

  return parseError(knowledge.error.value)
})

const hasItems = computed<boolean>(() => {
  return knowledge.items.value.length > 0
})

const selectedItem = computed<KnowledgeItem | null>(() => {
  return knowledge.items.value.find((item) => {
    return item.id === selectedItemId.value
  }) ?? null
})

const selectedNote = computed<KnowledgeItem | null>(() => {
  return selectedItem.value?.kind === 'note' ? selectedItem.value : null
})

const selectedFile = computed<KnowledgeItem | null>(() => {
  return selectedItem.value?.kind === 'file' ? selectedItem.value : null
})

const selectedFileTokens = computed<number | null>(() => {
  if (!selectedFile.value || !isMounted.value) {
    return null
  }

  return estimateKnowledgeItemTokens(selectedFile.value, modelContext.value)
})

const cacheTokens = computed<number | undefined>(() => {
  if (!isMounted.value) {
    return undefined
  }

  const state = computeKnowledgeMeter({
    totals: knowledge.totals.value,
    items: knowledge.items.value,
    mode: knowledge.mode.value,
    model: modelContext.value,
  })

  if (state.decision.mode !== 'full' || state.tokens <= 0) {
    return undefined
  }

  return state.tokens
})

const preparingRows = computed<KnowledgePreparingRow[]>(() => {
  if (upload.phase.value !== 'running') {
    return []
  }

  return upload.entries.value
    .filter(entry => PREPARING_STATUSES.includes(entry.status))
    .slice(0, MAX_PREPARING_ROWS)
    .map((entry) => {
      return { key: entry.key, name: entry.relativePath ?? entry.name }
    })
})

const isUploadRunningInBackground = computed<boolean>(() => {
  return upload.phase.value === 'running' && !isUploadSheetOpen.value
})

const syncableFolderIds = computed<string[]>(() => {
  const folderId = folders.syncedFolderId.value

  if (!canPickDirectory.value || !folderId) {
    return []
  }

  const hasFolder = knowledge.items.value.some((item) => {
    return item.folderId === folderId
  })

  return hasFolder ? [folderId] : []
})

function generateFolderId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

function reportFailure(title: string, parsed: ProjectKnowledgeError) {
  useErrorMessage(parsed.message || title, parsed.why)
}

async function startUpload(
  sources: KnowledgeUploadSource[],
  options: { folderId?: string, gitignoreText?: string } = {},
) {
  isUploadSheetOpen.value = true

  await upload.prepare(sources, options)
}

function openFilePicker() {
  itemToReplace.value = null
  fileInput.value?.click()
}

function openFolderPicker() {
  folderInput.value?.click()
}

function replaceItemFile(item: KnowledgeItem) {
  isItemSheetOpen.value = false
  itemToReplace.value = item
  fileInput.value?.click()
}

function openNewNote() {
  selectedItemId.value = null
  isNoteEditorOpen.value = true
}

function openItem(item: KnowledgeItem) {
  selectedItemId.value = item.id

  if (item.kind === 'note') {
    isNoteEditorOpen.value = true

    return
  }

  isItemSheetOpen.value = true
}

async function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])

  input.value = ''

  if (files.length === 0) {
    return
  }

  const replacement = itemToReplace.value

  itemToReplace.value = null

  if (replacement) {
    const outcome = await knowledge.removeItem(replacement.id)

    if (!outcome.ok) {
      reportFailure('Failed to remove the file', outcome.parsed)

      return
    }
  }

  await startUpload(files.map((file) => {
    return { file, relativePath: null }
  }))
}

async function readGitignoreText(
  entries: KnowledgePlanEntry[],
): Promise<string> {
  const gitignoreEntry = entries.find((entry) => {
    return entry.relativePath === GITIGNORE_FILE_NAME
  })

  return gitignoreEntry ? await gitignoreEntry.file.text() : ''
}

async function onFolderChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])

  input.value = ''

  if (files.length === 0) {
    return
  }

  const { rootName, entries } = entriesFromFileList(files)
  const folderId = generateFolderId()

  folders.remember(folderId, rootName ?? 'Folder')

  await startUpload(entries, {
    folderId,
    gitignoreText: await readGitignoreText(entries),
  })
}

async function pickSyncedFolder() {
  const directoryWindow = window as DirectoryPickerWindow

  if (!directoryWindow.showDirectoryPicker) {
    return
  }

  isReadingFolder.value = true

  try {
    const handle = await directoryWindow.showDirectoryPicker({ mode: 'read' })
    const { rootName, entries, gitignoreText } = (
      await readDirectoryHandleEntries(handle)
    )
    const folderId = generateFolderId()

    await saveKnowledgeDirectoryHandle(props.projectId, handle)
    folders.remember(folderId, rootName, { isSynced: true })
    isReadingFolder.value = false

    await startUpload(entries, { folderId, gitignoreText })
  } catch (exception) {
    if (exception instanceof DOMException && exception.name === 'AbortError') {
      return
    }

    reportFailure('Failed to read the folder', parseError(exception))
  } finally {
    isReadingFolder.value = false
  }
}

async function syncFolder(folderId: string) {
  syncingFolderId.value = folderId

  try {
    const handle = await loadKnowledgeDirectoryHandle(props.projectId)

    if (!handle) {
      folders.forgetSync()
      useInfoMessage(
        'Choose the folder again',
        'Besidka no longer has access to it. Use "Sync with a folder".',
      )

      return
    }

    const { entries, gitignoreText } = await readDirectoryHandleEntries(handle)
    const existing = knowledge.items.value.flatMap((item) => {
      if (item.folderId !== folderId || !item.relativePath) {
        return []
      }

      return [{ id: item.id, relativePath: item.relativePath, contentHash: '' }]
    })

    isUploadSheetOpen.value = true

    await upload.syncFolder({
      folderId,
      incoming: entries,
      existing,
      gitignoreText,
    })
  } catch (exception) {
    reportFailure('Failed to sync the folder', parseError(exception))
  } finally {
    syncingFolderId.value = null
  }
}

async function onLibrarySelect(files: KnowledgeLibraryFile[]) {
  const sources: KnowledgeUploadSource[] = []

  for (const file of files) {
    try {
      const blob = await $fetch<Blob>(
        `/files/${encodeURIComponent(file.storageKey)}`,
        { responseType: 'blob' },
      )

      sources.push({
        file: new File([blob], file.name, { type: file.type }),
        relativePath: null,
        fileId: file.id,
      })
    } catch (exception) {
      reportFailure(`Could not read ${file.name}`, parseError(exception))
    }
  }

  if (sources.length === 0) {
    return
  }

  await startUpload(sources)
}

async function onModeSelect(mode: KnowledgeMode) {
  const outcome = await knowledge.setMode(mode)

  if (!outcome.ok) {
    reportFailure('Failed to change the mode', outcome.parsed)
  }
}

async function removeWithConfirm(item: KnowledgeItem) {
  const confirmation = await useConfirm({
    text: `Remove "${getKnowledgeItemName(item)}"?`,
    subtitle: 'Besidka stops using it in this project. This cannot be undone.',
    alert: true,
    actions: ['Remove'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  removingId.value = item.id

  const outcome = await knowledge.removeItem(item.id)

  removingId.value = null

  if (!outcome.ok) {
    reportFailure('Failed to remove the item', outcome.parsed)

    return
  }

  if (selectedItemId.value === item.id) {
    isItemSheetOpen.value = false
    isNoteEditorOpen.value = false
  }

  useInfoMessage('Removed', 'Knowledge item removed.')
  refreshStorage()
}

function onUploadCancel() {
  if (upload.phase.value === 'running') {
    upload.cancel()

    return
  }

  isUploadSheetOpen.value = false
  upload.reset()
}

function describeFinishedUpload(): string {
  const entries = upload.entries.value
  const added = entries.filter((entry) => {
    return entry.status === 'ready' || entry.status === 'no-text'
  }).length
  const failed = entries.filter(entry => entry.status === 'failed').length
  const addedText = `${added} ${added === 1 ? 'file' : 'files'} added`

  return failed > 0 ? `${addedText}, ${failed} failed.` : `${addedText}.`
}

watch(() => upload.phase.value, async (phase, previousPhase) => {
  if (previousPhase !== 'running') {
    return
  }

  if (phase !== 'done' && phase !== 'error') {
    return
  }

  await knowledge.refresh()
  refreshStorage()

  if (isUploadSheetOpen.value) {
    return
  }

  if (phase === 'error' && upload.error.value) {
    useErrorMessage(upload.error.value.message, upload.error.value.why)
  } else {
    useInfoMessage('Knowledge updated', describeFinishedUpload())
  }

  upload.reset()
})

watch(isUploadSheetOpen, (isOpen) => {
  if (isOpen || upload.phase.value === 'running') {
    return
  }

  upload.reset()
})

watch(isNoteEditorOpen, (isOpen) => {
  if (!isOpen) {
    refreshStorage()
  }
})

watchPostEffect(() => {
  const current = selection.value

  if (!isMounted.value || current.source !== 'gateway') {
    return
  }

  hydrateGatewayCatalog(current.gatewayId)
})

onMounted(() => {
  canPickDirectory.value = supportsDirectoryPicker()
  isMounted.value = true
})
</script>
