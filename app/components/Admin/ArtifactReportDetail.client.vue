<template>
  <div
    class="grid gap-4 py-3"
    data-testid="admin-report-detail"
  >
    <div
      v-if="status === 'pending' && !report"
      class="grid gap-2"
    >
      <div class="skeleton skeleton--default h-16 w-full" />
      <div class="skeleton skeleton--default h-48 w-full" />
    </div>
    <div
      v-else-if="error || !report"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="admin-report-detail-error"
    >
      <span class="grow">This report did not load.</span>
      <button
        type="button"
        class="btn btn-sm"
        @click="refresh()"
      >
        Retry
      </button>
    </div>
    <template v-else>
      <header class="grid gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            v-if="report.priority === 'urgent'"
            class="badge badge-soft badge-error badge-sm"
          >
            Urgent
          </span>
          <span class="badge badge-soft badge-sm">
            {{ ARTIFACT_REPORT_REASON_LABELS[report.reason] }}
          </span>
          <span
            class="badge badge-soft badge-sm"
            data-testid="admin-report-detail-status"
          >
            {{ REPORT_STATUS_LABELS[report.status] }}
          </span>
          <span
            v-if="report.decision"
            class="badge badge-soft badge-sm"
          >
            {{ REPORT_DECISION_LABELS[report.decision] }}
          </span>
        </div>
        <p class="text-xs text-base-content/70">
          Report #{{ report.id }} ·
          <UiLocalDate
            :value="report.createdAt"
            with-time
          />
        </p>
      </header>

      <dl class="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt class="text-base-content/70">
          Artifact
        </dt>
        <dd class="break-words">
          <template v-if="report.artifact">
            {{ report.artifact.title }}
            <code class="block text-xs opacity-70">{{ report.artifact.id }}</code>
          </template>
          <span v-else>Deleted ({{ report.artifactId }})</span>
        </dd>
        <dt class="text-base-content/70">
          Owner
        </dt>
        <dd class="break-all">
          {{ describeOwner(report) }}
        </dd>
        <dt class="text-base-content/70">
          Where
        </dt>
        <dd
          class="break-all"
          data-testid="admin-report-detail-location"
        >
          {{ report.locationUrl ?? '—' }}
          <span
            v-if="report.share"
            class="block text-xs opacity-70"
          >
            Link {{ report.share.id }} ·
            {{ SHARE_STATUS_LABELS[report.share.status] }}
          </span>
          <span
            v-else-if="report.chatShareId"
            class="block text-xs opacity-70"
          >
            Shared chat {{ report.chatShareId }}
          </span>
        </dd>
        <dt class="text-base-content/70">
          Reporter
        </dt>
        <dd class="break-all">
          {{ describeReporter(report) }}
          <span
            v-if="report.receiptSentAt"
            class="block text-xs opacity-70"
          >
            Receipt sent
          </span>
        </dd>
        <template v-if="report.artifact?.takedownAt">
          <dt class="text-base-content/70">
            Taken down
          </dt>
          <dd>
            <UiLocalDate
              :value="report.artifact.takedownAt"
              with-time
            />
          </dd>
        </template>
        <template v-if="report.artifact?.legalHoldUntil">
          <dt class="text-base-content/70">
            Legal hold
          </dt>
          <dd>
            Until
            <UiLocalDate :value="report.artifact.legalHoldUntil" />
          </dd>
        </template>
      </dl>

      <section class="grid gap-1">
        <h3 class="text-sm font-medium">
          Details
        </h3>
        <p
          class="rounded-box bg-base-200/60 p-3 text-sm break-words whitespace-pre-wrap"
          data-testid="admin-report-detail-details"
        >
          {{ report.details }}
        </p>
      </section>

      <section
        v-if="report.decisionStatement"
        class="grid gap-1"
      >
        <h3 class="text-sm font-medium">
          Statement of reasons
        </h3>
        <p class="rounded-box bg-base-200/60 p-3 text-sm break-words whitespace-pre-wrap">
          {{ report.decisionStatement }}
        </p>
      </section>

      <section
        v-if="report.previewVersion && report.artifact"
        class="grid gap-1"
      >
        <h3 class="text-sm font-medium">
          Preview (v{{ report.previewVersion }}, read only)
        </h3>
        <div
          class="relative h-80 overflow-hidden rounded-box border border-base-300 bg-base-100"
          data-testid="admin-report-preview"
        >
          <ChatArtifactFrame
            v-if="previewResult"
            :key="`${report.artifact.id}:${report.previewVersion}`"
            :title="previewResult.title"
            :result="previewResult"
            :partial="null"
            :artifact-id="null"
            :version="report.previewVersion"
            source="shared"
          />
          <p
            v-else-if="previewError"
            class="grid h-full place-items-center p-4 text-sm text-base-content/70"
          >
            {{ previewError }}
          </p>
          <div
            v-else
            class="skeleton skeleton--default size-full"
          />
        </div>
      </section>

      <div
        v-if="canRestore"
        class="flex flex-wrap gap-2"
      >
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isRestoring"
          data-testid="admin-report-restore"
          @click="onRestore"
        >
          {{ restoreLabel }}
        </button>
      </div>

      <form
        v-if="report.status === 'open'"
        class="bubble rounded-box grid gap-3 p-4"
        data-testid="admin-report-action-form"
        @submit.prevent="onAction"
      >
        <h3 class="font-medium">
          Decision
        </h3>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">
            Action
          </legend>
          <label class="label min-h-6 cursor-pointer gap-2 text-sm text-base-content">
            <input
              v-model="action"
              type="radio"
              value="takedown"
              class="radio radio-sm"
              :name="`${formId}-action`"
              data-testid="admin-report-action-takedown"
            >
            Take down
          </label>
          <label class="label min-h-6 cursor-pointer gap-2 text-sm text-base-content">
            <input
              v-model="action"
              type="radio"
              value="reject"
              class="radio radio-sm"
              :name="`${formId}-action`"
              data-testid="admin-report-action-reject"
            >
            Reject (no action)
          </label>
        </fieldset>
        <label
          v-if="action === 'takedown'"
          class="grid gap-1"
        >
          <span class="text-sm">Scope</span>
          <select
            v-model="scope"
            class="select select-sm w-full"
            data-testid="admin-report-action-scope"
          >
            <option
              v-if="report.share"
              value="share"
            >
              This link only
            </option>
            <option value="all-shares">
              The artifact everywhere
            </option>
          </select>
        </label>
        <label
          class="grid gap-1"
          :for="`${formId}-statement`"
        >
          <span class="text-sm">
            {{ action === 'takedown'
              ? 'Statement of reasons (sent to the owner)'
              : 'Reasons (sent to the reporter)' }}
          </span>
        </label>
        <textarea
          :id="`${formId}-statement`"
          v-model="statement"
          class="textarea w-full"
          rows="5"
          :maxlength="ARTIFACT_TAKEDOWN_STATEMENT_MAX"
          :aria-describedby="`${formId}-statement-count`"
          data-testid="admin-report-action-statement"
        />
        <p
          :id="`${formId}-statement-count`"
          class="text-xs text-base-content/70"
          aria-live="polite"
        >
          {{ statementLength }} / {{ ARTIFACT_TAKEDOWN_STATEMENT_MAX }}
          (at least {{ ARTIFACT_TAKEDOWN_STATEMENT_MIN }})
        </p>
        <div class="flex justify-end">
          <button
            type="submit"
            class="btn btn-sm"
            :class="action === 'takedown' ? 'btn-error' : 'btn-primary'"
            :disabled="!canSubmitAction || isActing"
            data-testid="admin-report-action-submit"
          >
            {{ action === 'takedown' ? 'Take down' : 'Reject report' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { ToolResultContent } from '@besidka/artifacts-protocol'
import type {
  AdminArtifactReportDetail,
  ArtifactReportAction,
  ArtifactReportActionScope,
  ArtifactVersionContent,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_REPORT_REASON_LABELS,
  ARTIFACT_TAKEDOWN_STATEMENT_MAX,
  ARTIFACT_TAKEDOWN_STATEMENT_MIN,
} from '#shared/utils/artifacts'
import {
  REPORT_DECISION_LABELS,
  REPORT_STATUS_LABELS,
  SHARE_STATUS_LABELS,
} from '~/utils/admin-artifact-reports'

const props = defineProps<{
  reportId: number
  onChanged?: () => unknown
}>()

const RESTORE_ACTION = 'Restore'

const formId = useId()
const action = shallowRef<ArtifactReportAction>('takedown')
const scope = shallowRef<ArtifactReportActionScope>('all-shares')
const statement = shallowRef<string>('')
const isActing = shallowRef<boolean>(false)
const isRestoring = shallowRef<boolean>(false)
const previewResult = shallowRef<ToolResultContent | null>(null)
const previewError = shallowRef<string>('')

const { data: report, status, error, refresh } = useLazyFetch(
  () => `/api/v1/admin/artifact-reports/${props.reportId}`,
  { key: `admin-artifact-report-${props.reportId}` },
)

const statementLength = computed<number>(() => {
  return statement.value.trim().length
})

const canSubmitAction = computed<boolean>(() => {
  return statementLength.value >= ARTIFACT_TAKEDOWN_STATEMENT_MIN
    && statementLength.value <= ARTIFACT_TAKEDOWN_STATEMENT_MAX
})

const canRestore = computed<boolean>(() => {
  const value = report.value

  if (!value?.artifact) {
    return false
  }

  return !!value.artifact.takedownAt || value.share?.status === 'taken-down'
})

const restoreLabel = computed<string>(() => {
  return report.value?.artifact?.takedownAt
    ? 'Restore artifact'
    : 'Restore link'
})

function describeOwner(value: AdminArtifactReportDetail): string {
  if (!value.artifact) {
    return '—'
  }

  return value.artifact.ownerEmail ?? `account #${value.artifact.ownerUserId}`
}

function describeReporter(value: AdminArtifactReportDetail): string {
  const parts = [
    value.reporterName,
    value.reporterEmail,
    value.reporterUserId ? `account #${value.reporterUserId}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : 'Anonymous'
}

async function loadPreview(value: AdminArtifactReportDetail | null) {
  previewResult.value = null
  previewError.value = ''

  if (!value?.artifact || !value.previewVersion) {
    return
  }

  try {
    const content = await $fetch<ArtifactVersionContent>(
      `/api/v1/admin/artifacts/${encodeURIComponent(value.artifact.id)}`
      + `/versions/${value.previewVersion}`,
    )

    previewResult.value = {
      kind: content.kind,
      title: content.title,
      content: content.content,
    }
  } catch (exception) {
    previewError.value = parseError(exception).message
      || 'The preview did not load.'
  }
}

watch(report, (value) => {
  if (value) {
    scope.value = value.share ? 'share' : 'all-shares'
  }

  loadPreview(value ?? null)
}, { immediate: true })

async function afterChange() {
  await refresh()
  await props.onChanged?.()
}

async function onAction() {
  const value = report.value

  if (!value || !canSubmitAction.value || isActing.value) {
    return
  }

  isActing.value = true

  try {
    await $fetch(`/api/v1/admin/artifact-reports/${value.id}/action`, {
      method: 'POST',
      body: {
        action: action.value,
        statement: statement.value.trim(),
        scope: scope.value,
      },
    })

    statement.value = ''
    useSuccessMessage(
      action.value === 'takedown' ? 'Taken down' : 'Report rejected',
    )
    await afterChange()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'The decision was not saved',
      parsedException.why,
    )
  } finally {
    isActing.value = false
  }
}

async function onRestore() {
  const value = report.value

  if (!value?.artifact || isRestoring.value) {
    return
  }

  const restoresArtifact = !!value.artifact.takedownAt
  const result = await useConfirm({
    text: restoresArtifact ? 'Restore this artifact?' : 'Restore this link?',
    subtitle: 'No email is sent. Answer the owner from the privacy mailbox.',
    actions: [RESTORE_ACTION],
    labelDecline: 'Cancel',
  })

  if (result?.label !== RESTORE_ACTION) {
    return
  }

  isRestoring.value = true

  try {
    await $fetch('/api/v1/admin/artifact-takedowns/restore', {
      method: 'POST',
      body: restoresArtifact
        ? { artifactId: value.artifact.id }
        : { shareId: value.share?.id },
    })

    useSuccessMessage('Restored')
    await afterChange()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Restore failed',
      parsedException.why,
    )
  } finally {
    isRestoring.value = false
  }
}
</script>
