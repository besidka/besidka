<template>
  <section
    class="bubble rounded-box grid gap-6 p-6"
    data-testid="admin-feature-grants"
  >
    <div class="grid gap-1">
      <h3 class="text-lg font-bold">Per-user access</h3>
      <p class="text-sm text-base-content/70">
        An allow grant turns the feature on for one account; a deny grant
        keeps it off, even for admins and the rollout. Grants apply on the
        account's next request.
      </p>
    </div>
    <form
      class="grid gap-3 md:grid-cols-2"
      data-testid="admin-grant-form"
      @submit.prevent="submitGrant"
    >
      <div class="grid gap-1 md:col-span-2">
        <span class="text-sm font-medium">Account</span>
        <div
          v-if="selectedUser"
          class="flex items-center justify-between gap-2 rounded-field border border-base-300 px-3 py-2"
          data-testid="admin-grant-selected-user"
        >
          <span class="grid min-w-0">
            <span class="font-medium truncate">{{ selectedUser.name }}</span>
            <span class="text-xs opacity-70 break-all">
              {{ selectedUser.email }}
            </span>
          </span>
          <UiButton
            text="Change"
            size="xs"
            mode="default"
            ghost
            normal-case
            @click="selectedUser = null"
          />
        </div>
        <AdminUserSearch
          v-else
          @select="selectedUser = $event"
        />
      </div>
      <label class="grid gap-1">
        <span class="text-sm font-medium">Effect</span>
        <select
          v-model="effect"
          class="select w-full"
          data-testid="admin-grant-effect"
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-sm font-medium">Expires</span>
        <select
          v-model="expiresInDays"
          class="select w-full"
          data-testid="admin-grant-expiry"
        >
          <option
            v-for="option in expiryOptions"
            :key="option.label"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
      <label
        v-if="variants.length && effect === 'allow'"
        class="grid gap-1"
      >
        <span class="text-sm font-medium">Forced variant</span>
        <select
          v-model="variant"
          class="select w-full"
        >
          <option :value="null">None</option>
          <option
            v-for="key in variants"
            :key="key"
            :value="key"
          >
            {{ key }}
          </option>
        </select>
      </label>
      <label class="grid gap-1 md:col-span-2">
        <span class="text-sm font-medium">Reason (optional)</span>
        <input
          v-model="reason"
          type="text"
          class="input w-full"
          :maxlength="FEATURE_GRANT_REASON_MAX_LENGTH"
          placeholder="For example: tests the share flow"
          data-testid="admin-grant-reason"
        >
        <span class="text-xs text-base-content/70">
          Do not write names or emails here.
        </span>
      </label>
      <div class="flex justify-end md:col-span-2">
        <UiButton
          type="submit"
          text="Save grant"
          size="sm"
          normal-case
          :disabled="!selectedUser || isSaving"
          data-testid="admin-grant-submit"
        />
      </div>
    </form>
    <div
      v-if="status === 'pending' && !data"
      class="grid gap-2"
    >
      <div class="skeleton skeleton--default h-12 w-full" />
      <div class="skeleton skeleton--default h-12 w-full" />
    </div>
    <div
      v-else-if="error"
      role="alert"
      class="alert alert-error alert-soft"
    >
      <span>The grants did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="reloadGrants"
      />
    </div>
    <p
      v-else-if="!grants.length"
      class="text-sm text-base-content/70"
      data-testid="admin-grants-empty"
    >
      No account has a grant for this feature.
    </p>
    <ul
      v-else
      class="grid divide-y divide-base-300"
      data-testid="admin-grants-list"
    >
      <li
        v-for="grant in grants"
        :key="grant.id"
        class="flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <span class="grid min-w-0 gap-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-medium break-all">
              {{ grant.email ?? `Deleted account #${grant.userId}` }}
            </span>
            <span
              class="badge badge-soft badge-sm"
              :class="grant.effect === 'allow'
                ? 'badge-success'
                : 'badge-error'"
            >
              {{ grant.effect }}
            </span>
            <span
              v-if="grant.variant"
              class="badge badge-soft badge-sm"
            >
              {{ grant.variant }}
            </span>
          </span>
          <span class="text-xs text-base-content/70">
            <template v-if="grant.expiresAt">
              Expires
              <UiLocalDate :value="grant.expiresAt * 1000" />
            </template>
            <template v-else>No expiry</template>
            <template v-if="grant.reason"> · {{ grant.reason }}</template>
          </span>
        </span>
        <UiButton
          text="Revoke"
          size="sm"
          mode="error"
          outline
          normal-case
          :disabled="isSaving"
          :data-testid="`admin-grant-revoke-${grant.id}`"
          @click="revokeGrant(grant)"
        />
      </li>
    </ul>
    <div
      v-if="nextOffset !== null"
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
  </section>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { FEATURE_GRANT_REASON_MAX_LENGTH } from '#shared/utils/features/admin-schemas'
import type { AdminSearchUser } from '~/utils/admin-features'

interface AdminGrantRow {
  id: number
  userId: number
  email: string | null
  name: string | null
  effect: 'allow' | 'deny'
  variant: string | null
  expiresAt: number | null
  reason: string | null
}

const props = defineProps<{
  flag: string
  variants: string[]
}>()

const emit = defineEmits<{
  changed: []
}>()

const expiryOptions = [
  { label: 'Never', value: null },
  { label: 'In 7 days', value: 7 },
  { label: 'In 30 days', value: 30 },
  { label: 'In 90 days', value: 90 },
  { label: 'In 365 days', value: 365 },
]

const selectedUser = shallowRef<AdminSearchUser | null>(null)
const effect = shallowRef<'allow' | 'deny'>('allow')
const expiresInDays = shallowRef<number | null>(null)
const variant = shallowRef<string | null>(null)
const reason = shallowRef<string>('')
const isSaving = shallowRef<boolean>(false)
const isLoadingMore = shallowRef<boolean>(false)
const extraGrants = shallowRef<AdminGrantRow[]>([])
const extraNextOffset = shallowRef<number | null | undefined>(undefined)

function grantsUrl(): `/api/v1/admin/features/${string}/grants` {
  return `/api/v1/admin/features/${encodeURIComponent(props.flag)}/grants`
}

const { data, status, error, refresh } = await useLazyFetch(grantsUrl)

const grants = computed<AdminGrantRow[]>(() => {
  return [
    ...(data.value?.grants ?? []) as AdminGrantRow[],
    ...extraGrants.value,
  ]
})

const nextOffset = computed<number | null>(() => {
  return extraNextOffset.value === undefined
    ? data.value?.nextOffset ?? null
    : extraNextOffset.value
})

async function reloadGrants() {
  extraGrants.value = []
  extraNextOffset.value = undefined
  await refresh()
}

async function loadMore() {
  if (nextOffset.value === null) {
    return
  }

  isLoadingMore.value = true

  try {
    const page = await $fetch(grantsUrl(), {
      query: { offset: nextOffset.value },
    })

    extraGrants.value = [
      ...extraGrants.value,
      ...page.grants as AdminGrantRow[],
    ]
    extraNextOffset.value = page.nextOffset
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to load more grants',
      parsedException.why,
    )
  } finally {
    isLoadingMore.value = false
  }
}

async function submitGrant() {
  if (!selectedUser.value) {
    return
  }

  isSaving.value = true

  try {
    await $fetch(grantsUrl(), {
      method: 'POST',
      body: {
        userId: selectedUser.value.id,
        effect: effect.value,
        variant: effect.value === 'allow' ? variant.value : null,
        expiresInDays: expiresInDays.value,
        reason: reason.value.trim() || null,
      },
    })
    selectedUser.value = null
    reason.value = ''
    variant.value = null
    await reloadGrants()
    emit('changed')
    useSuccessMessage('Grant saved')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save the grant',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}

async function revokeGrant(grant: AdminGrantRow) {
  const result = await useConfirm({
    text: `Revoke the ${grant.effect} grant?`,
    subtitle: `${grant.email ?? 'This account'} falls back to the rule `
      + `for ${props.flag} on its next request.`,
    actions: ['Revoke'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isSaving.value = true

  try {
    await $fetch(`/api/v1/admin/features/grants/${grant.id}/revoke`, {
      method: 'POST',
    })
    await reloadGrants()
    emit('changed')
    useSuccessMessage('Grant revoked')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to revoke the grant',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}
</script>
