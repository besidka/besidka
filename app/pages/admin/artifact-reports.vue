<template>
  <div class="grid gap-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <label class="grid gap-1 sm:max-w-xs">
        <span class="text-sm font-medium">Status</span>
        <select
          v-model="statusFilter"
          class="select w-full"
          data-testid="admin-reports-status-filter"
        >
          <option :value="null">
            All reports
          </option>
          <option
            v-for="value in ARTIFACT_REPORT_STATUSES"
            :key="value"
            :value="value"
          >
            {{ REPORT_STATUS_LABELS[value] }}
          </option>
        </select>
      </label>
      <p
        v-if="data"
        class="text-sm text-base-content/70"
        data-testid="admin-reports-total"
      >
        {{ data.total }} {{ data.total === 1 ? 'report' : 'reports' }}
      </p>
    </div>

    <div
      v-if="status === 'pending' && !data"
      class="grid gap-2"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="skeleton skeleton--default h-20 w-full"
      />
    </div>
    <div
      v-else-if="error || !data"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="admin-reports-error"
    >
      <span>The reports did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="refresh()"
      />
    </div>
    <p
      v-else-if="!data.items.length"
      class="text-sm text-base-content/70"
      data-testid="admin-reports-empty"
    >
      No reports.
    </p>
    <ul
      v-else
      class="grid gap-3"
      data-testid="admin-reports-list"
    >
      <li
        v-for="report in data.items"
        :key="report.id"
      >
        <button
          type="button"
          class="bubble rounded-box grid w-full gap-1 p-4 text-left hover:bg-base-200/60 focus-visible:outline-2 focus-visible:outline-primary"
          :data-testid="`admin-report-row-${report.id}`"
          @click="openReport(report)"
        >
          <span class="flex flex-wrap items-center gap-1.5 text-sm">
            <span
              v-if="report.priority === 'urgent'"
              class="badge badge-soft badge-error badge-sm"
              data-testid="admin-report-urgent"
            >
              Urgent
            </span>
            <span class="badge badge-soft badge-sm">
              {{ ARTIFACT_REPORT_REASON_LABELS[report.reason] }}
            </span>
            <span class="badge badge-soft badge-sm">
              {{ REPORT_STATUS_LABELS[report.status] }}
            </span>
            <span class="ml-auto text-xs text-base-content/70">
              <UiLocalDate
                :value="report.createdAt"
                with-time
              />
            </span>
          </span>
          <span class="font-medium break-words">
            {{ report.artifact?.title ?? 'Deleted artifact' }}
          </span>
          <span class="text-xs break-all text-base-content/70">
            {{ report.artifact?.ownerEmail
              ?? (report.artifact
                ? `account #${report.artifact.ownerUserId}`
                : report.artifactId) }}
          </span>
          <span class="line-clamp-2 text-sm break-words text-base-content/80">
            {{ report.detailsPreview }}
          </span>
        </button>
      </li>
    </ul>

    <div
      v-if="data && data.total > PAGE_SIZE"
      class="flex items-center justify-center gap-2"
    >
      <button
        type="button"
        class="btn btn-sm"
        :disabled="offset === 0"
        @click="offset = Math.max(0, offset - PAGE_SIZE)"
      >
        Previous
      </button>
      <span class="text-sm text-base-content/70">
        {{ offset + 1 }}–{{ Math.min(offset + PAGE_SIZE, data.total) }}
      </span>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="offset + PAGE_SIZE >= data.total"
        @click="offset += PAGE_SIZE"
      >
        Next
      </button>
    </div>

    <AdminArtifactTakedownForm @changed="refresh()" />

    <p class="text-xs text-base-content/70">
      Closed reports are kept for 12 months (24 for a copyright removal).
    </p>
  </div>
</template>

<script setup lang="ts">
import type {
  AdminArtifactReportSummary,
  ArtifactReportStatus,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_REPORT_REASON_LABELS,
  ARTIFACT_REPORT_STATUSES,
} from '#shared/utils/artifacts'
import { REPORT_STATUS_LABELS } from '~/utils/admin-artifact-reports'
import { LazyAdminArtifactReportDetail } from '#components'

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Reports · Admin',
  robots: 'noindex, nofollow',
})

const PAGE_SIZE = 20

const sidePanel = useSidePanel()
const statusFilter = shallowRef<ArtifactReportStatus | null>(null)
const offset = shallowRef<number>(0)

const reportsQuery = computed(() => {
  return {
    ...(statusFilter.value ? { status: statusFilter.value } : {}),
    offset: offset.value,
    limit: PAGE_SIZE,
  }
})

const { data, status, error, refresh } = await useLazyFetch(
  '/api/v1/admin/artifact-reports',
  { query: reportsQuery },
)

watch(statusFilter, () => {
  offset.value = 0
})

function openReport(report: AdminArtifactReportSummary) {
  sidePanel.open({
    viewKey: `admin-artifact-report:${report.id}`,
    title: `Report #${report.id}`,
    mode: 'detail',
    component: LazyAdminArtifactReportDetail,
    props: {
      reportId: report.id,
      onChanged: refresh,
    },
  })
}

onBeforeUnmount(() => {
  if (sidePanel.viewKey.value?.startsWith('admin-artifact-report:')) {
    sidePanel.close()
  }
})
</script>
