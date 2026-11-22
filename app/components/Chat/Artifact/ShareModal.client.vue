<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-artifact-share-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      aria-modal="true"
      data-testid="artifact-share-modal"
      @close="onClosed"
    >
      <div class="modal-box sheet-safe-padding flex max-h-[85dvh] w-full max-w-lg flex-col">
        <header class="flex shrink-0 items-start gap-3">
          <div class="min-w-0 grow">
            <h2
              :id="headingId"
              class="text-lg font-bold"
            >
              Share artifact
            </h2>
            <p class="text-sm break-words text-base-content/70">
              {{ title }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle shrink-0"
            aria-label="Close"
            data-testid="artifact-share-close"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
              aria-hidden="true"
            />
          </button>
        </header>

        <div class="-mx-1.5 mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-1.5 py-1">
          <section
            v-if="createdShare"
            class="space-y-2"
            data-testid="artifact-share-created"
          >
            <label
              class="label text-sm"
              :for="`${formId}-link`"
            >
              New link
            </label>
            <div class="join w-full">
              <input
                :id="`${formId}-link`"
                type="text"
                readonly
                class="input join-item min-w-0 flex-1"
                :value="createdShare.url ?? ''"
                data-testid="artifact-share-link-input"
                @focus="selectInput"
              >
              <button
                type="button"
                class="btn join-item gap-1.5"
                data-testid="artifact-share-copy"
                @click="copyLink(createdShare)"
              >
                <Icon
                  :name="copiedShareId === createdShare.shareId
                    ? 'lucide:check'
                    : 'lucide:copy'"
                  size="14"
                  aria-hidden="true"
                />
                {{ copiedShareId === createdShare.shareId ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              data-testid="artifact-share-new"
              @click="createdShare = null"
            >
              Create another link
            </button>
          </section>

          <form
            v-else
            class="space-y-3"
            data-testid="artifact-share-form"
            @submit.prevent="onCreate"
          >
            <div>
              <label
                class="label mb-1.5 text-sm"
                :for="`${formId}-duration`"
              >
                Link expires
              </label>
              <select
                :id="`${formId}-duration`"
                v-model="duration"
                class="select select-sm w-full"
                data-testid="artifact-share-duration"
              >
                <option
                  v-for="option in DURATION_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">
                Version
              </legend>
              <label class="label min-h-6 cursor-pointer gap-2 text-sm whitespace-normal text-base-content">
                <input
                  v-model="versionMode"
                  type="radio"
                  value="latest"
                  class="radio radio-sm"
                  :name="`${formId}-version`"
                  data-testid="artifact-share-version-latest"
                >
                Always show the latest version
              </label>
              <label class="label min-h-6 cursor-pointer gap-2 text-sm whitespace-normal text-base-content">
                <input
                  v-model="versionMode"
                  type="radio"
                  value="pinned"
                  class="radio radio-sm"
                  :name="`${formId}-version`"
                  data-testid="artifact-share-version-pinned"
                >
                Pin version v{{ currentVersion }}
              </label>
            </fieldset>

            <label class="flex cursor-pointer items-start justify-between gap-3">
              <span class="min-w-0 text-sm">
                <span class="block">Let signed-in viewers save progress</span>
                <span class="block text-xs text-base-content/70">
                  Answers and scores are kept for each viewer, in their own
                  account. You never see them.
                </span>
              </span>
              <input
                v-model="storageAllowed"
                type="checkbox"
                class="toggle toggle-sm mt-0.5 shrink-0"
                data-testid="artifact-share-storage"
              >
            </label>

            <label class="flex cursor-pointer items-start justify-between gap-3">
              <span class="min-w-0 text-sm">
                <span class="block">
                  Let signed-in viewers use AI features on their own key
                </span>
                <span class="block text-xs text-base-content/70">
                  Viewers confirm every AI request, and it runs on their key,
                  never on yours.
                </span>
              </span>
              <input
                v-model="bridgeAllowed"
                type="checkbox"
                class="toggle toggle-sm mt-0.5 shrink-0"
                data-testid="artifact-share-bridge"
              >
            </label>

            <p
              class="alert alert-info alert-soft text-sm"
              role="note"
              data-testid="artifact-share-privacy-note"
            >
              <Icon
                name="lucide:globe"
                size="16"
                class="shrink-0"
                aria-hidden="true"
              />
              <span>{{ PRIVACY_NOTE }}</span>
            </p>

            <p
              class="alert alert-info alert-soft text-sm"
              role="note"
              data-testid="artifact-share-search-note"
            >
              <Icon
                name="lucide:eye-off"
                size="16"
                class="shrink-0"
                aria-hidden="true"
              />
              <span>{{ SEARCH_NOTE }}</span>
            </p>

            <div
              class="min-h-16"
              data-testid="artifact-share-pii-slot"
            >
              <div
                v-if="piiView === 'pending'"
                class="skeleton skeleton--default h-16 w-full rounded-box"
                data-testid="artifact-share-pii-pending"
              />
              <p
                v-else-if="piiView === 'warning'"
                class="alert alert-warning alert-soft text-sm"
                role="alert"
                data-testid="artifact-share-pii-warning"
              >
                <Icon
                  name="lucide:triangle-alert"
                  size="16"
                  class="shrink-0"
                  aria-hidden="true"
                />
                <span>
                  This version may contain personal data
                  ({{ piiLabels }}). Anyone with the link can read it.
                </span>
              </p>
              <p
                v-else
                class="alert alert-soft text-sm"
                role="note"
                data-testid="artifact-share-pii-reminder"
              >
                <Icon
                  name="lucide:info"
                  size="16"
                  class="shrink-0"
                  aria-hidden="true"
                />
                <span>
                  Check the artifact for personal data before you share it.
                  The check can miss things.
                </span>
              </p>
            </div>

            <p
              v-if="isAtLimit"
              class="alert alert-warning alert-soft text-sm"
              role="status"
              data-testid="artifact-share-limit"
            >
              <Icon
                name="lucide:link-2-off"
                size="16"
                class="shrink-0"
                aria-hidden="true"
              />
              <span>
                This artifact has {{ ARTIFACT_SHARE_MAX_ACTIVE }} active links,
                the most it can have. Turn one off to create another.
              </span>
            </p>

            <div class="flex justify-end">
              <button
                type="submit"
                class="btn btn-primary btn-sm"
                :disabled="isCreating || isAtLimit || isLoadingList"
                data-testid="artifact-share-create"
              >
                <span
                  v-if="isCreating"
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                />
                Create link
              </button>
            </div>
          </form>

          <section
            class="space-y-2 border-t border-base-300 pt-3"
            aria-label="Links to this artifact"
            data-testid="artifact-share-list"
          >
            <h3 class="text-sm font-medium">
              Links
            </h3>
            <div
              v-if="isLoadingList && !shares.length"
              class="space-y-2"
            >
              <div class="skeleton skeleton--default h-14 w-full rounded-box" />
              <div class="skeleton skeleton--default h-14 w-full rounded-box" />
            </div>
            <div
              v-else-if="listError"
              class="alert alert-error alert-soft text-sm"
              role="alert"
              data-testid="artifact-share-list-error"
            >
              <span class="grow">{{ listError }}</span>
              <button
                type="button"
                class="btn btn-sm"
                @click="loadShares"
              >
                Retry
              </button>
            </div>
            <p
              v-else-if="!shares.length"
              class="text-sm text-base-content/70"
              data-testid="artifact-share-list-empty"
            >
              No links yet.
            </p>
            <ul
              v-else
              class="space-y-2"
            >
              <li
                v-for="share in shares"
                :key="share.shareId"
                class="flex flex-wrap items-center gap-2 rounded-box border border-base-300 p-2 text-sm"
                :data-testid="`artifact-share-row-${share.shareId}`"
              >
                <div class="min-w-0 grow space-y-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span
                      class="badge badge-soft badge-sm"
                      :class="STATUS_BADGES[share.status]"
                      data-testid="artifact-share-status"
                    >
                      {{ STATUS_LABELS[share.status] }}
                    </span>
                    <span class="badge badge-soft badge-sm">
                      {{ share.pinnedVersion
                        ? `v${share.pinnedVersion}`
                        : 'Latest version' }}
                    </span>
                    <span
                      class="badge badge-soft badge-sm"
                      data-testid="artifact-share-visibility"
                    >
                      Hidden from search engines
                    </span>
                    <span
                      v-if="share.storageAllowed"
                      class="badge badge-soft badge-sm"
                    >
                      Saves progress
                    </span>
                    <span
                      v-if="share.bridgeAllowed"
                      class="badge badge-soft badge-sm"
                    >
                      AI on viewer's key
                    </span>
                  </div>
                  <p class="text-xs text-base-content/70">
                    <template v-if="share.status === 'active'">
                      <template v-if="share.expiresAt">
                        Expires
                        <UiLocalDate
                          :value="share.expiresAt"
                          with-time
                        />
                      </template>
                      <template v-else>
                        Never expires
                      </template>
                    </template>
                    <template v-else>
                      Created
                      <UiLocalDate :value="share.createdAt" />
                    </template>
                  </p>
                  <p
                    v-if="share.createdVia === 'mcp'"
                    class="text-xs text-base-content/70"
                    data-testid="artifact-share-mcp"
                  >
                    Created by connected app
                    {{ share.clientName || 'an AI app' }}
                  </p>
                </div>
                <div
                  v-if="share.status === 'active'"
                  class="flex shrink-0 gap-1"
                >
                  <button
                    v-if="share.url"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :aria-label="`Copy link ${share.shareId}`"
                    data-testid="artifact-share-row-copy"
                    @click="copyLink(share)"
                  >
                    <Icon
                      :name="copiedShareId === share.shareId
                        ? 'lucide:check'
                        : 'lucide:copy'"
                      size="14"
                      aria-hidden="true"
                    />
                    {{ copiedShareId === share.shareId ? 'Copied' : 'Copy' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-error btn-soft btn-sm"
                    :disabled="revokingShareId === share.shareId"
                    data-testid="artifact-share-revoke"
                    @click="onRevoke(share)"
                  >
                    Turn off
                  </button>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button
          type="submit"
          aria-label="Close"
          tabindex="-1"
        >
          Close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  ArtifactShareDuration,
  ArtifactShareStatus,
  ArtifactShareSummary,
} from '#shared/utils/artifacts'
import type { SharePiiKind } from '#shared/types/share-pii.d'
import { ARTIFACT_SHARE_MAX_ACTIVE } from '#shared/utils/artifacts'
import { SHARE_PII_KIND_LABELS } from '#shared/utils/share-pii'

type VersionMode = 'latest' | 'pinned'

type PiiView = 'pending' | 'warning' | 'reminder'

const props = defineProps<{
  artifactId: string
  title: string
  currentVersion: number
}>()

const isOpen = defineModel<boolean>('open', { required: true })

const PRIVACY_NOTE
  = 'Anyone with the link can see this artifact. Viewers can report it.'
const SEARCH_NOTE
  = 'Private by default: only people who have the link can open it, '
    + 'and search engines never show it.'
const COPIED_RESET_MS = 2000
const REVOKE_ACTION = 'Turn off'
const DURATION_OPTIONS: Array<{
  value: ArtifactShareDuration
  label: string
}> = [
  { value: 'hour', label: '1 hour' },
  { value: 'day', label: '1 day' },
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
  { value: 'year', label: '1 year' },
  { value: 'never', label: 'Never' },
]
const STATUS_LABELS: Record<ArtifactShareStatus, string> = {
  'active': 'Active',
  'expired': 'Expired',
  'revoked': 'Turned off',
  'taken-down': 'Removed after a report',
}
const STATUS_BADGES: Record<ArtifactShareStatus, string> = {
  'active': 'badge-success',
  'expired': '',
  'revoked': '',
  'taken-down': 'badge-error',
}

const formId = useId()
const headingId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const duration = shallowRef<ArtifactShareDuration>('week')
const versionMode = shallowRef<VersionMode>('latest')
const storageAllowed = shallowRef<boolean>(false)
const bridgeAllowed = shallowRef<boolean>(false)
const shares = shallowRef<ArtifactShareSummary[]>([])
const createdShare = shallowRef<ArtifactShareSummary | null>(null)
const isLoadingList = shallowRef<boolean>(false)
const listError = shallowRef<string>('')
const isCreating = shallowRef<boolean>(false)
const revokingShareId = shallowRef<string>('')
const copiedShareId = shallowRef<string>('')
const piiStatus = shallowRef<'pending' | 'done' | 'error'>('pending')
const piiKinds = shallowRef<string[]>([])

let returnFocusTarget: HTMLElement | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let piiRequestId = 0

const basePath = computed<string>(() => {
  return `/api/v1/artifacts/${encodeURIComponent(props.artifactId)}/shares`
})

const pinnedVersion = computed<number | null>(() => {
  return versionMode.value === 'pinned' ? props.currentVersion : null
})

const activeCount = computed<number>(() => {
  return shares.value.filter((share) => {
    return share.status === 'active'
  }).length
})

const isAtLimit = computed<boolean>(() => {
  return activeCount.value >= ARTIFACT_SHARE_MAX_ACTIVE
})

const piiView = computed<PiiView>(() => {
  if (piiStatus.value === 'pending') {
    return 'pending'
  }

  return piiStatus.value === 'done' && piiKinds.value.length > 0
    ? 'warning'
    : 'reminder'
})

const piiLabels = computed<string>(() => {
  const labels = piiKinds.value.map((kind) => {
    return SHARE_PII_KIND_LABELS[kind as SharePiiKind] ?? kind
  })

  return [...new Set(labels)].join(', ')
})

function resetForm() {
  duration.value = 'week'
  versionMode.value = 'latest'
  storageAllowed.value = false
  bridgeAllowed.value = false
  createdShare.value = null
  copiedShareId.value = ''
}

function showError(exception: unknown, fallback: string) {
  const parsedException = parseError(exception)

  useErrorMessage(parsedException.message || fallback, parsedException.why)
}

async function loadShares() {
  isLoadingList.value = true
  listError.value = ''

  try {
    const result = await $fetch<{ shares: ArtifactShareSummary[] }>(
      basePath.value,
    )

    shares.value = result.shares
  } catch (exception) {
    listError.value = parseError(exception).message
      || 'The links did not load.'
  } finally {
    isLoadingList.value = false
  }
}

async function runPiiCheck() {
  const requestId = ++piiRequestId

  piiStatus.value = 'pending'

  try {
    const result = await $fetch<{ warnings: string[] }>(
      `${basePath.value}/check`,
      {
        method: 'POST',
        body: { pinnedVersion: pinnedVersion.value },
      },
    )

    if (requestId !== piiRequestId) {
      return
    }

    piiKinds.value = result.warnings
    piiStatus.value = 'done'
  } catch {
    if (requestId !== piiRequestId) {
      return
    }

    piiKinds.value = []
    piiStatus.value = 'error'
  }
}

function selectInput(event: FocusEvent) {
  (event.target as HTMLInputElement | null)?.select()
}

async function copyLink(share: ArtifactShareSummary) {
  if (!share.url) {
    return
  }

  try {
    await navigator.clipboard.writeText(share.url)
    copiedShareId.value = share.shareId

    if (copiedTimer) {
      clearTimeout(copiedTimer)
    }

    copiedTimer = setTimeout(() => {
      copiedShareId.value = ''
      copiedTimer = null
    }, COPIED_RESET_MS)
  } catch {
    useErrorMessage('Failed to copy the link')
  }
}

async function onCreate() {
  if (isCreating.value || isAtLimit.value) {
    return
  }

  isCreating.value = true

  try {
    const result = await $fetch<{
      share: ArtifactShareSummary
      url: string
    }>(basePath.value, {
      method: 'POST',
      body: {
        duration: duration.value,
        pinnedVersion: pinnedVersion.value,
        storageAllowed: storageAllowed.value,
        bridgeAllowed: bridgeAllowed.value,
      },
    })

    const created: ArtifactShareSummary = { ...result.share, url: result.url }

    createdShare.value = created
    shares.value = [
      created,
      ...shares.value.filter((share) => {
        return share.shareId !== created.shareId
      }),
    ]
    await copyLink(created)
  } catch (exception) {
    const { statusCode } = (exception ?? {}) as { statusCode?: unknown }

    if (statusCode === 409) {
      await loadShares()
    }

    showError(exception, 'Failed to create the link')
  } finally {
    isCreating.value = false
  }
}

async function onRevoke(share: ArtifactShareSummary) {
  const result = await useConfirm({
    text: 'Turn off this link?',
    subtitle: 'Anyone who opens it will see that it is not available. '
      + 'This cannot be undone.',
    alert: true,
    actions: [REVOKE_ACTION],
    labelDecline: 'Cancel',
  })

  if (result?.label !== REVOKE_ACTION) {
    return
  }

  revokingShareId.value = share.shareId

  try {
    await $fetch(
      `${basePath.value}/${encodeURIComponent(share.shareId)}/revoke`,
      { method: 'POST' },
    )

    if (createdShare.value?.shareId === share.shareId) {
      createdShare.value = null
    }

    await loadShares()
    useSuccessMessage('Link turned off')
  } catch (exception) {
    showError(exception, 'Failed to turn off the link')
  } finally {
    revokingShareId.value = ''
  }
}

function close() {
  isOpen.value = false
}

function onClosed() {
  isOpen.value = false
  piiRequestId += 1

  const target = returnFocusTarget

  returnFocusTarget = null

  if (target?.isConnected) {
    target.focus()
  }
}

async function syncDialog(open: boolean) {
  await nextTick()

  const dialog = modal.value

  if (!dialog) {
    return
  }

  if (!open) {
    if (dialog.open) {
      dialog.close()
    }

    return
  }

  if (dialog.open) {
    return
  }

  returnFocusTarget = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  resetForm()
  dialog.showModal()
  await Promise.all([loadShares(), runPiiCheck()])
}

watch(isOpen, syncDialog, { flush: 'post' })

onMounted(() => {
  syncDialog(isOpen.value)
})

watch(pinnedVersion, () => {
  if (isOpen.value) {
    runPiiCheck()
  }
})

onBeforeUnmount(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
})
</script>
