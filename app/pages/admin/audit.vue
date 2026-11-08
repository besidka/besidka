<template>
  <div class="grid gap-6">
    <label class="grid gap-1 sm:max-w-xs">
      <span class="text-sm font-medium">Feature</span>
      <select
        v-model="flagFilter"
        class="select w-full"
        data-testid="admin-audit-flag-filter"
      >
        <option :value="null">All features and roles</option>
        <option
          v-for="key in FEATURE_KEYS"
          :key="key"
          :value="key"
        >
          {{ key }}
        </option>
      </select>
    </label>
    <div
      v-if="status === 'pending' && !data"
      class="grid gap-2"
    >
      <div
        v-for="index in 4"
        :key="index"
        class="skeleton skeleton--default h-16 w-full"
      />
    </div>
    <div
      v-else-if="error || !data"
      role="alert"
      class="alert alert-error alert-soft"
    >
      <span>The audit log did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="reload"
      />
    </div>
    <p
      v-else-if="!entries.length"
      class="text-sm text-base-content/70"
      data-testid="admin-audit-empty"
    >
      No changes recorded yet.
    </p>
    <ul
      v-else
      class="grid gap-3"
      data-testid="admin-audit-list"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="bubble rounded-box grid gap-2 p-4"
      >
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="badge badge-soft badge-sm">{{ entry.action }}</span>
          <code
            v-if="entry.flag"
            class="text-xs"
          >{{ entry.flag }}</code>
          <span class="ml-auto text-xs text-base-content/70">
            <UiLocalDate
              v-if="entry.createdAt"
              :value="entry.createdAt * 1000"
              with-time
            />
          </span>
        </div>
        <p class="text-xs text-base-content/70 break-all">
          By {{ describeActor(entry) }}
          <template v-if="entry.targetUserId">
            · for {{ entry.targetEmail ?? `account #${entry.targetUserId}` }}
          </template>
        </p>
        <div class="grid gap-1 text-xs sm:grid-cols-2">
          <pre class="bg-base-200 rounded-field overflow-x-auto p-2 whitespace-pre-wrap break-all">{{ formatAuditSnapshot(entry.before) }}</pre>
          <pre class="bg-base-200 rounded-field overflow-x-auto p-2 whitespace-pre-wrap break-all">{{ formatAuditSnapshot(entry.after) }}</pre>
        </div>
      </li>
    </ul>
    <div
      v-if="nextCursor !== null"
      class="flex justify-center"
    >
      <UiButton
        text="Load more"
        size="sm"
        mode="default"
        outline
        normal-case
        :disabled="isLoadingMore"
        @click="loadMore"
      />
    </div>
    <p class="text-xs text-base-content/70">
      Entries are kept for 12 months. Left: before, right: after.
    </p>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { FEATURE_KEYS } from '#shared/utils/features/registry'

interface AdminAuditRow {
  id: number
  action: string
  actorKind: string
  actorUserId: number | null
  actorEmail: string | null
  flag: string | null
  targetUserId: number | null
  targetEmail: string | null
  before: unknown
  after: unknown
  createdAt: number | null
}

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Audit · Admin',
  robots: 'noindex, nofollow',
})

const flagFilter = shallowRef<string | null>(null)
const extraEntries = shallowRef<AdminAuditRow[]>([])
const extraNextCursor = shallowRef<number | null | undefined>(undefined)
const isLoadingMore = shallowRef<boolean>(false)

const auditQuery = computed(() => {
  return flagFilter.value ? { flag: flagFilter.value } : {}
})

const { data, status, error, refresh } = await useLazyFetch(
  '/api/v1/admin/audit',
  { query: auditQuery },
)

const entries = computed<AdminAuditRow[]>(() => {
  return [
    ...(data.value?.entries ?? []) as AdminAuditRow[],
    ...extraEntries.value,
  ]
})

const nextCursor = computed<number | null>(() => {
  return extraNextCursor.value === undefined
    ? data.value?.nextCursor ?? null
    : extraNextCursor.value
})

watch(flagFilter, () => {
  extraEntries.value = []
  extraNextCursor.value = undefined
})

function describeActor(entry: AdminAuditRow): string {
  const who = entry.actorEmail
    ?? (entry.actorUserId ? `account #${entry.actorUserId}` : 'a deleted account')

  return entry.actorKind === 'mcp' ? `${who} (MCP)` : who
}

async function reload() {
  extraEntries.value = []
  extraNextCursor.value = undefined
  await refresh()
}

async function loadMore() {
  if (nextCursor.value === null) {
    return
  }

  isLoadingMore.value = true

  try {
    const page = await $fetch('/api/v1/admin/audit', {
      query: { ...auditQuery.value, cursor: nextCursor.value },
    })

    extraEntries.value = [
      ...extraEntries.value,
      ...page.entries as AdminAuditRow[],
    ]
    extraNextCursor.value = page.nextCursor
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to load more entries',
      parsedException.why,
    )
  } finally {
    isLoadingMore.value = false
  }
}
</script>
