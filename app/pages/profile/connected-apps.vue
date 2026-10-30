<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Connected apps</h1>
    <h2 class="mt-2">Apps you've allowed to use your Besidka account</h2>
  </div>
  <div class="grid gap-6">
    <ProfileSecuritySectionCard
      heading="Apps with access"
      description="Apps such as Claude connect through MCP and can only do
        what you approved. You can remove permissions here; to add one,
        reconnect the app. Disconnecting an app ends its access right away."
    >
      <template #icon>
        <Icon
          name="lucide:plug"
          size="20"
          class="shrink-0"
          aria-hidden="true"
        />
      </template>
      <div
        v-if="status === 'pending'"
        class="grid gap-2"
      >
        <div class="skeleton skeleton--default h-14 w-full" />
        <div class="skeleton skeleton--default h-14 w-full" />
      </div>
      <p
        v-else-if="!apps.length"
        class="text-sm text-base-content/70"
        data-testid="connected-apps-empty"
      >
        No apps are connected to your account.
      </p>
      <ul
        v-else
        class="grid gap-6"
        data-testid="connected-apps-list"
      >
        <li
          v-for="group in groups"
          :key="group.key"
          class="grid gap-4"
          :data-testid="`connected-apps-group-${group.key}`"
        >
          <div
            v-if="group.apps.length > 1"
            role="note"
            class="alert alert-info alert-soft text-sm"
            data-testid="connected-apps-duplicates-note"
          >
            <Icon
              name="lucide:info"
              size="16"
              class="shrink-0"
              aria-hidden="true"
            />
            <span>
              {{ group.name }} registers a new connection each time you
              reconnect it. Older ones keep working until you disconnect
              them.
            </span>
            <UiButton
              text="Disconnect older"
              mode="error"
              outline
              size="sm"
              normal-case
              :disabled="isProcessing"
              data-testid="connected-apps-disconnect-older"
              @click="revokeOlder(group)"
            />
          </div>
          <ul class="grid gap-4">
            <li
              v-for="app in group.apps"
              :key="app.clientId"
              class="grid gap-3"
            >
              <div
                class="grid gap-2 sm:flex sm:items-start sm:justify-between
                  sm:gap-4"
              >
                <div class="grid gap-1 min-w-0">
                  <p class="flex flex-wrap items-center gap-2 font-bold">
                    <span class="break-words min-w-0">{{ app.name }}</span>
                    <span
                      v-if="group.apps.length > 1
                        && app.clientId === group.newestClientId"
                      class="badge badge-sm badge-soft badge-success"
                      data-testid="connected-apps-newest"
                    >
                      Most recent
                    </span>
                  </p>
                  <p class="text-sm text-base-content/70">
                    Connected
                    <UiLocalDate :value="app.createdAt" />
                    <template v-if="app.lastUsedAt">
                      · Last active
                      <UiLocalDate
                        :value="app.lastUsedAt"
                        with-time
                      />
                    </template>
                  </p>
                  <ul class="flex flex-wrap gap-1">
                    <li
                      v-for="scope in filterVisibleScopes(app.scopes)"
                      :key="scope"
                      class="badge badge-sm badge-soft"
                      :class="isMcpWriteScope(scope)
                        ? 'badge-warning'
                        : 'badge-neutral'"
                    >
                      <OAuthScopeLabel :scope="scope" />
                    </li>
                  </ul>
                </div>
                <div class="flex flex-wrap gap-2 shrink-0">
                  <UiButton
                    v-if="canEditPermissions(app)"
                    text="Edit permissions"
                    mode="neutral"
                    outline
                    size="sm"
                    normal-case
                    :disabled="isProcessing"
                    :data-testid="`connected-apps-edit-${app.clientId}`"
                    @click="toggleEditor(app)"
                  />
                  <UiButton
                    text="Disconnect"
                    mode="error"
                    outline
                    size="sm"
                    :disabled="isProcessing"
                    :data-testid="`connected-apps-revoke-${app.clientId}`"
                    @click="revoke(app)"
                  />
                </div>
              </div>
              <ProfileConnectedAppsPermissionsEditor
                v-if="editingClientId === app.clientId"
                :app="app"
                @saved="finishEditing"
                @cancel="editingClientId = null"
              />
            </li>
          </ul>
        </li>
      </ul>
    </ProfileSecuritySectionCard>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { isMcpWriteScope } from '#shared/utils/mcp-oauth-scopes'
import type {
  ConnectedApp,
  ConnectedAppGroup,
} from '~/utils/connected-apps'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Connected apps',
  robots: 'noindex, nofollow',
})

const { data, status, refresh } = await useLazyFetch(
  '/api/v1/profiles/connected-apps',
)

const BULK_REVOKE_LIMIT = 20

const isProcessing = shallowRef<boolean>(false)
const editingClientId = shallowRef<string | null>(null)

const apps = computed<ConnectedApp[]>(() => {
  return (data.value ?? []) as unknown as ConnectedApp[]
})

const groups = computed<ConnectedAppGroup[]>(() => {
  return groupConnectedApps(apps.value)
})

function canEditPermissions(app: ConnectedApp): boolean {
  return app.canEditScopes && filterEditableScopes(app.scopes).length > 0
}

function toggleEditor(app: ConnectedApp) {
  editingClientId.value = editingClientId.value === app.clientId
    ? null
    : app.clientId
}

async function finishEditing() {
  editingClientId.value = null
  await refresh()
}

async function revoke(app: ConnectedApp) {
  const result = await useConfirm({
    text: `Disconnect ${app.name}?`,
    subtitle: 'The app loses access to your account right away. To use it '
      + 'again, you have to connect it again.',
    actions: ['Disconnect'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    await $fetch(
      `/api/v1/profiles/connected-apps/${encodeURIComponent(app.clientId)}/revoke`,
      { method: 'post' },
    )
    editingClientId.value = null
    await refresh()
    useSuccessMessage(`${app.name} disconnected`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to disconnect the app',
      parsedException.why,
    )
  } finally {
    isProcessing.value = false
  }
}

async function revokeOlder(group: ConnectedAppGroup) {
  const olderApps = listOlderConnections(group)

  if (!olderApps.length) {
    return
  }

  const result = await useConfirm({
    text: `Disconnect ${olderApps.length} older `
      + `${olderApps.length === 1 ? 'connection' : 'connections'} of `
      + `${group.name}?`,
    subtitle: 'The most recently used connection stays. The older ones '
      + 'lose access to your account right away.',
    actions: ['Disconnect older'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    const clientIds = olderApps.map((app) => {
      return app.clientId
    })

    for (
      let offset = 0;
      offset < clientIds.length;
      offset += BULK_REVOKE_LIMIT
    ) {
      await $fetch('/api/v1/profiles/connected-apps/revoke/bulk', {
        method: 'post',
        body: {
          clientIds: clientIds.slice(offset, offset + BULK_REVOKE_LIMIT),
        },
      })
    }

    editingClientId.value = null
    await refresh()
    useSuccessMessage(`Older ${group.name} connections disconnected`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to disconnect the older connections',
      parsedException.why,
    )
  } finally {
    isProcessing.value = false
  }
}
</script>
