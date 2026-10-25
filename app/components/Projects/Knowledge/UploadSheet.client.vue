<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-knowledge-upload-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="knowledge-upload-modal"
      @close="onModalClosed"
    >
      <div class="modal-box flex max-h-[85dvh] max-w-2xl flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
            data-testid="knowledge-upload-heading"
          >
            {{ heading }}
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              :aria-label="phase === 'running' ? 'Hide' : 'Close'"
              data-testid="knowledge-upload-close"
            >
              <Icon
                name="lucide:x"
                size="16"
              />
            </button>
          </form>
        </div>
        <div class="-me-2 min-h-0 flex-1 overflow-y-auto pe-2">
          <div
            v-if="phase === 'planning'"
            class="grid gap-2"
            aria-busy="true"
            data-testid="knowledge-upload-planning"
          >
            <p class="text-sm">Checking your files…</p>
            <div class="skeleton skeleton--default h-4 w-2/3" />
            <div class="skeleton skeleton--default h-4 w-1/2" />
          </div>
          <div
            v-else-if="phase === 'preview'"
            class="grid gap-4"
            data-testid="knowledge-upload-preview"
          >
            <p
              v-if="!syncSummary"
              class="text-sm"
              data-testid="knowledge-upload-preview-summary"
            >
              {{ previewSentence }}
            </p>
            <p
              v-if="syncSummary"
              class="text-sm"
              data-testid="knowledge-upload-sync"
            >
              {{ describeSync(syncSummary) }}
            </p>
            <ul
              v-if="plan?.details?.length"
              class="grid gap-1 break-all text-sm text-base-content/70"
              aria-label="Skipped files"
              data-testid="knowledge-upload-skipped-details"
            >
              <li
                v-for="detail in visibleSkipDetails"
                :key="detail.path"
              >
                Skipped: {{ detail.path }} — {{ detail.issue }}
              </li>
            </ul>
            <ul
              v-if="plan && plan.reasons.length > 0"
              class="grid gap-1 text-sm text-base-content/70"
              aria-label="Why files are skipped"
              data-testid="knowledge-upload-reasons"
            >
              <li
                v-for="reason in plan.reasons"
                :key="reason.reason"
                class="first-letter:uppercase"
              >
                {{ reason.label }}: {{ reason.count }}
              </li>
            </ul>
          </div>
          <div
            v-else-if="phase === 'running'"
            class="grid gap-3"
            data-testid="knowledge-upload-running"
          >
            <progress
              class="progress progress-primary w-full"
              :value="progress.done"
              :max="Math.max(progress.total, 1)"
              aria-valuemin="0"
              :aria-valuemax="Math.max(progress.total, 1)"
              :aria-valuenow="progress.done"
              :aria-valuetext="`${progress.done} of ${progress.total} files`"
              aria-label="Upload progress"
              data-testid="knowledge-upload-progress"
            />
            <p
              class="text-sm"
              role="status"
              data-testid="knowledge-upload-current"
            >
              {{ progress.done }} of {{ progress.total }}
              <template v-if="progress.currentName">
                · {{ progress.currentName }}
              </template>
            </p>
          </div>
          <div
            v-else-if="phase === 'done' || phase === 'error'"
            class="grid gap-4"
            data-testid="knowledge-upload-summary"
          >
            <div
              v-if="phase === 'error' && error"
              role="alert"
              class="alert alert-soft alert-error !items-start"
              data-testid="knowledge-upload-error"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="break-words font-bold">{{ error.message }}</p>
                <p
                  v-if="error.why"
                  class="break-words text-sm"
                >
                  {{ error.why }}
                </p>
              </div>
            </div>
            <p
              v-if="wasCancelled"
              class="text-sm"
              data-testid="knowledge-upload-cancelled"
            >
              The upload was cancelled. Files that finished are kept.
            </p>
            <p
              v-if="syncResult || syncSummary"
              class="text-sm"
              data-testid="knowledge-upload-sync-result"
            >
              {{
                syncResult
                  ? describeSyncResult(syncResult)
                  : describeSync(syncSummary)
              }}
            </p>
            <ul
              v-if="syncResult && syncResult.notices.length > 0"
              class="grid gap-1 text-sm text-base-content/70"
              aria-label="Sync notices"
              data-testid="knowledge-upload-sync-notices"
            >
              <li
                v-for="notice in syncResult.notices"
                :key="notice"
              >
                {{ notice }}
              </li>
            </ul>
            <ul
              class="grid gap-1 text-sm"
              aria-label="Upload summary"
            >
              <li data-testid="knowledge-upload-added">
                {{ counts.added }}
                {{ counts.added === 1 ? 'file' : 'files' }} added
              </li>
              <li
                v-if="counts.noText > 0"
                data-testid="knowledge-upload-no-text"
              >
                {{ counts.noText }} with no text found
              </li>
              <li
                v-if="counts.duplicates > 0"
                data-testid="knowledge-upload-duplicates"
              >
                {{ counts.duplicates }} already added, skipped
              </li>
              <li
                v-if="counts.failed > 0"
                class="text-error"
                data-testid="knowledge-upload-failed"
              >
                {{ counts.failed }} failed
              </li>
            </ul>
          </div>
          <ul
            v-if="showEntries"
            class="
              mt-4 grid max-h-[min(320px,40dvh)] gap-1 overflow-y-auto
              text-sm
            "
            aria-label="Files"
            data-testid="knowledge-upload-entries"
          >
            <li
              v-for="entry in visibleEntries"
              :key="entry.key"
              class="flex min-w-0 items-start justify-between gap-3"
              :data-status="entry.status"
              data-testid="knowledge-upload-entry"
            >
              <span class="min-w-0 break-all">
                {{ entry.relativePath ?? entry.name }}
              </span>
              <span
                class="shrink-0 text-right text-xs"
                :class="entry.status === 'failed'
                  ? 'text-error'
                  : 'text-base-content/60'"
              >
                {{ describeEntry(entry) }}
              </span>
            </li>
            <li
              v-if="hiddenEntryCount > 0"
              class="text-xs text-base-content/60"
            >
              and {{ hiddenEntryCount }} more
            </li>
          </ul>
        </div>
        <div class="mt-4 flex shrink-0 flex-wrap justify-end gap-2">
          <template v-if="phase === 'preview'">
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              text="Cancel"
              normal-case
              data-testid="knowledge-upload-cancel"
              @click="emit('cancel')"
            />
            <UiButton
              size="sm"
              normal-case
              :text="startLabel"
              :disabled="!hasWork"
              data-testid="knowledge-upload-start"
              @click="emit('start')"
            />
          </template>
          <template v-else-if="phase === 'running'">
            <UiButton
              mode="neutral"
              outline
              size="sm"
              text="Cancel upload"
              normal-case
              data-testid="knowledge-upload-cancel"
              @click="emit('cancel')"
            />
          </template>
          <template v-else-if="phase === 'planning'">
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              text="Cancel"
              normal-case
              data-testid="knowledge-upload-cancel"
              @click="emit('cancel')"
            />
          </template>
          <template v-else>
            <UiButton
              v-if="counts.failed > 0"
              mode="neutral"
              outline
              size="sm"
              text="Retry failed"
              normal-case
              data-testid="knowledge-upload-retry"
              @click="emit('retry')"
            />
            <UiButton
              size="sm"
              text="Done"
              normal-case
              data-testid="knowledge-upload-done"
              @click="open = false"
            />
          </template>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { KnowledgePlanSummary } from '~/utils/knowledge-upload-plan'
import type {
  KnowledgeSyncResult,
  KnowledgeSyncSummary,
  KnowledgeUploadEntry,
  KnowledgeUploadFailure,
  KnowledgeUploadPhase,
  KnowledgeUploadProgress,
} from '~/types/project-knowledge.d'

const MAX_LISTED_ENTRIES = 100
const MAX_LISTED_SKIP_DETAILS = 20

const props = defineProps<{
  phase: KnowledgeUploadPhase
  plan: KnowledgePlanSummary | null
  syncSummary: KnowledgeSyncSummary | null
  syncResult?: KnowledgeSyncResult | null
  wasCancelled: boolean
  entries: KnowledgeUploadEntry[]
  progress: KnowledgeUploadProgress
  error: KnowledgeUploadFailure | null
}>()

const emit = defineEmits<{
  start: []
  cancel: []
  retry: []
}>()

const open = defineModel<boolean>('open', { default: false })

const headingId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const statusLabels: Record<KnowledgeUploadEntry['status'], string> = {
  'queued': 'Waiting',
  'extracting': 'Reading…',
  'uploading-original': 'Uploading original…',
  'ready': 'Added',
  'no-text': 'No text found',
  'failed': 'Failed',
  'skipped-duplicate': 'Already added',
}

const heading = computed<string>(() => {
  switch (props.phase) {
    case 'planning':
      return 'Checking files'
    case 'preview':
      return 'Add to project knowledge'
    case 'running':
      return 'Adding files'
    case 'error':
      return 'Could not add files'
    default:
      return 'Files added'
  }
})

const previewSentence = computed<string>(() => {
  if (!props.plan) {
    return ''
  }

  const { added, skipped } = props.plan
  const addedText = `${added} ${added === 1 ? 'file' : 'files'} will be added`

  if (skipped === 0) {
    return `${addedText}.`
  }

  return `${addedText}, ${skipped} skipped.`
})

const hasWork = computed<boolean>(() => {
  if (props.syncSummary) {
    const { added, replaced, removed } = props.syncSummary

    return added + replaced + removed > 0
  }

  return (props.plan?.added ?? 0) > 0
})

const startLabel = computed<string>(() => {
  if (props.syncSummary) {
    return 'Sync folder'
  }

  const added = props.plan?.added ?? 0

  return added === 1 ? 'Add 1 file' : `Add ${added} files`
})

const counts = computed(() => {
  const countStatus = (status: KnowledgeUploadEntry['status']) => {
    return props.entries.filter(entry => entry.status === status).length
  }
  const noText = countStatus('no-text')

  return {
    added: countStatus('ready') + noText,
    noText,
    duplicates: countStatus('skipped-duplicate'),
    failed: countStatus('failed'),
  }
})

const showEntries = computed<boolean>(() => {
  return props.phase !== 'preview'
    && props.phase !== 'planning'
    && props.entries.length > 0
})

const visibleEntries = computed<KnowledgeUploadEntry[]>(() => {
  return props.entries.slice(0, MAX_LISTED_ENTRIES)
})

const visibleSkipDetails = computed(() => {
  return (props.plan?.details ?? []).slice(0, MAX_LISTED_SKIP_DETAILS)
})

const hiddenEntryCount = computed<number>(() => {
  return Math.max(0, props.entries.length - MAX_LISTED_ENTRIES)
})

function describeSync(syncSummary: KnowledgeSyncSummary | null): string {
  if (!syncSummary) {
    return ''
  }

  return `${syncSummary.added} new, ${syncSummary.replaced} to check, `
    + `${syncSummary.removed} missing, ${syncSummary.unchanged} unchanged.`
}

function describeSyncResult(syncResult: KnowledgeSyncResult): string {
  const unchanged = syncResult.unchanged + syncResult.unchangedUnknown

  return `Folder synced: ${syncResult.uploaded} new, ${unchanged} unchanged, `
    + `${syncResult.removed} removed.`
}

function describeEntry(entry: KnowledgeUploadEntry): string {
  if (entry.status === 'failed' || entry.status === 'no-text') {
    return entry.error
      ? describeKnowledgeExtractError(entry.error)
      : statusLabels[entry.status]
  }

  return statusLabels[entry.status]
}

function onModalClosed() {
  open.value = false
}

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    modal.value.showModal()

    return
  }

  modal.value.close()
}, { immediate: true, flush: 'post' })
</script>
