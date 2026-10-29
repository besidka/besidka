<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Connected apps</h1>
    <h2 class="mt-2">Apps you've allowed to use your Besidka account</h2>
  </div>
  <div class="grid gap-6">
    <ProfileSecuritySectionCard
      heading="Apps with access"
      description="Apps such as Claude connect through MCP and can only do
        what you approved. Disconnecting an app stops it from getting new
        access right away, but access it already has can keep working for up
        to 15 minutes."
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
        class="grid gap-4"
        data-testid="connected-apps-list"
      >
        <li
          v-for="app in apps"
          :key="app.clientId"
          class="grid gap-2 sm:flex sm:items-start sm:justify-between sm:gap-4"
        >
          <div class="grid gap-1 min-w-0">
            <p class="font-bold break-words">{{ app.name }}</p>
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
                v-for="scope in visibleScopes(app.scopes)"
                :key="scope"
                class="badge badge-sm"
                :class="isMcpWriteScope(scope) ? 'badge-warning' : 'badge-ghost'"
              >
                <OAuthScopeLabel :scope="scope" />
              </li>
            </ul>
          </div>
          <UiButton
            text="Disconnect"
            mode="error"
            outline
            size="sm"
            class="shrink-0"
            :disabled="isProcessing"
            :data-testid="`connected-apps-revoke-${app.clientId}`"
            @click="revoke(app)"
          />
        </li>
      </ul>
    </ProfileSecuritySectionCard>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import {
  isMcpWriteScope,
  MCP_IDENTITY_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

interface ConnectedApp {
  clientId: string
  name: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}

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

const isProcessing = shallowRef<boolean>(false)

const apps = computed<ConnectedApp[]>(() => {
  return (data.value ?? []) as unknown as ConnectedApp[]
})

const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)

function visibleScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => {
    return !identityScopeSet.has(scope)
  })
}

async function revoke(app: ConnectedApp) {
  const result = await useConfirm({
    text: `Disconnect ${app.name}?`,
    subtitle: 'The app loses access to your account. Access it already has '
      + 'can keep working for up to 15 minutes. To use it again, you have '
      + 'to connect it again.',
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
</script>
