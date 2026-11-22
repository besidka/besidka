<template>
  <section
    class="grid gap-4 p-4 sm:p-6"
    aria-labelledby="google-drive-connection-heading"
    data-testid="google-drive-connection"
  >
    <div class="flex flex-wrap items-center gap-3">
      <Icon
        name="lucide:hard-drive"
        size="20"
        class="shrink-0"
      />
      <h3
        id="google-drive-connection-heading"
        class="text-lg font-bold"
      >
        Google Drive
      </h3>
      <span
        v-if="viewState === 'connected'"
        class="badge badge-soft badge-success badge-sm"
        data-testid="google-drive-status"
      >
        Connected
      </span>
      <span
        v-else-if="viewState === 'needs_reauth'"
        class="badge badge-soft badge-warning badge-sm"
        data-testid="google-drive-status"
      >
        Reconnect needed
      </span>
    </div>
    <div
      v-if="viewState === 'loading'"
      class="skeleton skeleton--default h-16 w-full"
      data-testid="google-drive-skeleton"
    />
    <template v-else-if="viewState === 'disconnected'">
      <p class="text-sm text-base-content/70">
        Besidka can only see the files you pick.
      </p>
      <div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isBusy"
          data-testid="google-drive-connect"
          @click="connect"
        >
          Connect Google Drive
        </button>
      </div>
    </template>
    <template v-else>
      <div
        v-if="viewState === 'needs_reauth'"
        role="alert"
        class="alert alert-soft alert-warning text-sm"
        data-testid="google-drive-reauth-alert"
      >
        <Icon
          name="lucide:triangle-alert"
          size="16"
          class="shrink-0"
        />
        <p>
          Google no longer accepts Besidka's access, so the Google Drive
          files copied into Besidka were deleted. Reconnect to pick files
          again.
        </p>
      </div>
      <dl class="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <dt class="text-base-content/70">
          Google account
        </dt>
        <dd
          class="break-all"
          data-testid="google-drive-email"
        >
          {{ connection?.email ?? 'Unknown account' }}
        </dd>
        <template v-if="capabilityLabels.length > 0">
          <dt class="text-base-content/70">
            Besidka can access
          </dt>
          <dd>
            <ul
              class="grid gap-1"
              data-testid="google-drive-capabilities"
            >
              <li
                v-for="label in capabilityLabels"
                :key="label"
              >
                {{ label }}
              </li>
            </ul>
          </dd>
        </template>
      </dl>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="viewState === 'needs_reauth'"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isBusy"
          data-testid="google-drive-reconnect"
          @click="connect"
        >
          Reconnect
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="isBusy"
          data-testid="google-drive-disconnect"
          @click="disconnect"
        >
          Disconnect
        </button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  GOOGLE_CONNECT_DEFAULT_RETURN_PATH,
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
  isGoogleConnectResult,
} from '#shared/utils/google-connections'
import type {
  GoogleConnectResult,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'
import type { GoogleCapability } from '#shared/utils/google-scopes'

type ViewState = 'loading' | 'disconnected' | 'connected' | 'needs_reauth'

interface ResultMessage {
  type: 'success' | 'info' | 'error'
  title: string
  description?: string
}

const CAPABILITY_LABELS: Record<GoogleCapability, string> = {
  'identity': 'Your name and email address',
  'drive-picked': 'Only the Google Drive files you pick',
  'drive-read': 'All your Google Drive files, read only',
  'gmail-read': 'Your Gmail, read only',
  'gmail-compose': 'Gmail drafts',
  'calendar': 'Your Google Calendar events',
}

const RESULT_MESSAGES: Record<GoogleConnectResult, ResultMessage> = {
  connected: { type: 'success', title: 'Google Drive connected' },
  denied: {
    type: 'info',
    title: 'Google Drive was not connected',
    description: 'You canceled on the Google page.',
  },
  missing_scope: {
    type: 'error',
    title: 'Google Drive was not connected',
    description: 'Allow access to the files you pick, then try again.',
  },
  expired: {
    type: 'error',
    title: 'The connection timed out',
    description: 'Start again from this page.',
  },
  error: {
    type: 'error',
    title: 'Google Drive could not be connected',
    description: 'Try again in a moment.',
  },
}

const route = useRoute()
const isBusy = shallowRef<boolean>(false)

const { data, status, refresh } = await useLazyFetch(
  '/api/v1/google/connections',
  { key: 'google-drive-connection' },
)

const connection = computed<GoogleConnectionSummary | null>(() => {
  return data.value?.connection ?? null
})

const viewState = computed<ViewState>(() => {
  if (!data.value && status.value !== 'error') {
    return 'loading'
  }

  if (!connection.value) {
    return 'disconnected'
  }

  return connection.value.status === 'active' ? 'connected' : 'needs_reauth'
})

const capabilityLabels = computed<string[]>(() => {
  return (connection.value?.capabilities ?? []).map((capability) => {
    return CAPABILITY_LABELS[capability]
  })
})

function showResultMessage(result: GoogleConnectResult) {
  const message = RESULT_MESSAGES[result]

  if (message.type === 'success') {
    useSuccessMessage(message.title, message.description)

    return
  }

  if (message.type === 'info') {
    useInfoMessage(message.title, message.description)

    return
  }

  useErrorMessage(message.title, message.description)
}

async function handleConnectResult() {
  const result = route.query[GOOGLE_CONNECT_RESULT_QUERY_KEY]

  if (!isGoogleConnectResult(result)) {
    return
  }

  showResultMessage(result)

  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => {
      return key !== GOOGLE_CONNECT_RESULT_QUERY_KEY
    }),
  )

  await navigateTo({ query }, { replace: true })
}

async function connect() {
  isBusy.value = true

  try {
    const { authorizationUrl } = await $fetch('/api/v1/google/oauth/start', {
      method: 'POST',
      body: { returnTo: GOOGLE_CONNECT_DEFAULT_RETURN_PATH },
    })

    await navigateTo(authorizationUrl, { external: true })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Google Drive could not be connected',
      parsedException.why,
    )
    isBusy.value = false
  }
}

async function disconnect() {
  const confirmation = await useConfirm({
    text: 'Disconnect Google Drive?',
    subtitle: 'Besidka removes its access at Google, and the Google Drive '
      + 'files copied into Besidka will be deleted. This also happens '
      + 'whenever Google access ends.',
    alert: true,
    actions: ['Disconnect'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  isBusy.value = true

  try {
    const result = await $fetch('/api/v1/google/connections/disconnect', {
      method: 'POST',
    })

    useSuccessMessage(
      'Google Drive disconnected',
      result.filesPending
        ? 'The copied Google Drive files will be deleted within the hour.'
        : undefined,
    )
    await refresh()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Google Drive could not be disconnected',
      parsedException.why,
    )
  } finally {
    isBusy.value = false
  }
}

onMounted(async () => {
  await handleConnectResult()
})
</script>
