<template>
  <div class="grid gap-6">
    <section
      class="bubble rounded-box grid gap-4 p-6"
      data-testid="admin-add-tester"
    >
      <div class="grid gap-1">
        <h2 class="text-lg font-bold">Add a tester</h2>
        <p class="text-sm text-base-content/70">
          Testers get every feature whose rule allows the tester role. Only
          the tester role can be given here; admins come from
          <code>NUXT_ADMIN_EMAILS</code>.
        </p>
      </div>
      <AdminUserSearch @select="addTester" />
    </section>
    <section
      class="bubble rounded-box grid gap-4 p-6"
      data-testid="admin-roles"
    >
      <h2 class="text-lg font-bold">Roles</h2>
      <div
        v-if="status === 'pending' && !data"
        class="grid gap-2"
      >
        <div class="skeleton skeleton--default h-12 w-full" />
        <div class="skeleton skeleton--default h-12 w-full" />
      </div>
      <div
        v-else-if="error || !data"
        role="alert"
        class="alert alert-error alert-soft"
      >
        <span>The roles did not load.</span>
        <UiButton
          text="Retry"
          size="sm"
          mode="default"
          outline
          normal-case
          @click="refresh()"
        />
      </div>
      <ul
        v-else
        class="grid divide-y divide-base-300"
        data-testid="admin-roles-list"
      >
        <li
          v-for="admin in data.envAdmins"
          :key="`env-${admin.id}`"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <span class="grid min-w-0">
            <span class="font-medium break-all">{{ admin.email }}</span>
            <span class="text-xs opacity-70">{{ admin.name }}</span>
          </span>
          <span class="flex items-center gap-2">
            <span class="badge badge-soft badge-info badge-sm">admin</span>
            <span
              class="badge badge-soft badge-sm"
              data-testid="admin-env-badge"
            >
              from env
            </span>
          </span>
        </li>
        <li
          v-for="role in data.roles"
          :key="role.id"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <span class="grid min-w-0">
            <span class="font-medium break-all">
              {{ role.email ?? `Deleted account #${role.userId}` }}
            </span>
            <span class="text-xs opacity-70">{{ role.name }}</span>
          </span>
          <span class="flex items-center gap-2">
            <span
              class="badge badge-soft badge-sm"
              :class="{ 'badge-info': role.role === 'admin' }"
            >
              {{ role.role }}
            </span>
            <UiButton
              v-if="isAssignable(role.role)"
              text="Revoke"
              size="sm"
              mode="error"
              outline
              normal-case
              :disabled="isSaving"
              :data-testid="`admin-role-revoke-${role.id}`"
              @click="revokeRole(role)"
            />
          </span>
        </li>
        <li
          v-if="!data.envAdmins.length && !data.roles.length"
          class="py-3 text-sm text-base-content/70"
        >
          No account has a role yet.
        </li>
      </ul>
    </section>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { ASSIGNABLE_FEATURE_ROLES } from '#shared/utils/features/admin-schemas'
import type { AdminSearchUser } from '~/utils/admin-features'

interface AdminRoleRow {
  id: number
  userId: number
  role: string
  email: string | null
}

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Users · Admin',
  robots: 'noindex, nofollow',
})

const { data, status, error, refresh } = await useLazyFetch(
  '/api/v1/admin/roles',
)

const isSaving = shallowRef<boolean>(false)

function isAssignable(role: string): boolean {
  return (ASSIGNABLE_FEATURE_ROLES as readonly string[]).includes(role)
}

async function addTester(user: AdminSearchUser) {
  if (user.roles.some(role => role.role === 'tester')) {
    useSuccessMessage(`${user.email} is already a tester`)

    return
  }

  isSaving.value = true

  try {
    await $fetch('/api/v1/admin/roles', {
      method: 'POST',
      body: { userId: user.id, role: 'tester' },
    })
    await refresh()
    useSuccessMessage(`${user.email} is now a tester`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to add the tester',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}

async function revokeRole(role: AdminRoleRow) {
  const result = await useConfirm({
    text: `Remove the ${role.role} role?`,
    subtitle: `${role.email ?? 'This account'} loses every feature it got `
      + 'through this role on its next request.',
    actions: ['Remove'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isSaving.value = true

  try {
    await $fetch(`/api/v1/admin/roles/${role.id}/revoke`, { method: 'POST' })
    await refresh()
    useSuccessMessage('Role removed')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to remove the role',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}
</script>
