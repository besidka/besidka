<template>
  <section
    class="grid gap-4 p-4 sm:p-6"
    aria-labelledby="google-drive-connection-heading"
    data-testid="google-drive-connection"
  >
    <div class="flex flex-wrap items-center gap-3">
      <Icon
        :name="GOOGLE_DRIVE_ICON"
        size="20"
        class="shrink-0"
      />
      <h3
        id="google-drive-connection-heading"
        ref="heading"
        tabindex="-1"
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
    <p
      class="sr-only"
      aria-live="polite"
      data-testid="google-drive-announcement"
    >
      {{ announcement }}
    </p>
    <div
      v-if="viewState === 'loading'"
      class="skeleton skeleton--default h-16 w-full"
      data-testid="google-drive-skeleton"
    />
    <div
      v-else-if="viewState === 'error'"
      role="alert"
      class="alert alert-soft alert-error text-sm"
      data-testid="google-drive-load-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
      />
      <p>The Google Drive connection could not be loaded.</p>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="google-drive-retry"
        @click="retry"
      >
        Try again
      </button>
    </div>
    <template v-else-if="viewState === 'disconnected'">
      <ul
        class="grid list-disc gap-1 pl-5 text-sm text-base-content/70"
        data-testid="google-drive-explainer"
      >
        <li>Besidka gets access only to the Google Drive files you pick.</li>
        <li>Files you pick are copied into your Besidka files.</li>
        <li>
          Besidka reads your Google account's email address to show which
          account is connected.
        </li>
      </ul>
      <div v-if="canConnect">
        <button
          ref="connectButton"
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
          Google no longer accepts Besidka's access. The Google Drive files
          copied into Besidka are deleted when Google access ends.
          <template v-if="canConnect">
            Reconnect to pick files again.
          </template>
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
          v-if="viewState === 'needs_reauth' && canConnect"
          type="button"
          class="btn btn-primary"
          :disabled="isBusy"
          data-testid="google-drive-reconnect"
          @click="connect"
        >
          Reconnect
        </button>
        <UiButton
          mode="error"
          text="Disconnect"
          icon-name="lucide:unplug"
          :disabled="isBusy"
          outline
          data-testid="google-drive-disconnect"
          @click="disconnect"
        />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import {
  GOOGLE_CONNECT_KEYS_RETURN_PATH,
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
  GOOGLE_THIRD_PARTY_ACCESS_URL,
  isGoogleConnectResult,
} from '#shared/utils/google-connections'
import type { GoogleConnectionSummary } from '#shared/utils/google-connections'
import type { GoogleCapability } from '#shared/utils/google-scopes'
import { reportGoogleConnectResult } from '~/utils/google-connect-results'

type ViewState
  = 'loading' | 'error' | 'disconnected' | 'connected' | 'needs_reauth'

const CAPABILITY_LABELS: Partial<Record<GoogleCapability, string>> = {
  'drive-picked': 'Only the Google Drive files you pick',
  'drive-read': 'All your Google Drive files, read only',
  'gmail-read': 'Your Gmail, read only',
  'gmail-compose': 'Gmail drafts',
  'calendar': 'Your Google Calendar events',
}

const route = useRoute()
const isBusy = shallowRef<boolean>(false)
const announcement = shallowRef<string>('')
const heading = useTemplateRef<HTMLElement>('heading')
const connectButton = useTemplateRef<HTMLButtonElement>('connectButton')

const { data, status, refresh } = await useGoogleConnection()

const connection = computed<GoogleConnectionSummary | null>(() => {
  return data.value?.connection ?? null
})

const canConnect = computed<boolean>(() => {
  return data.value?.canConnect === true
})

const viewState = computed<ViewState>(() => {
  if (!data.value) {
    return status.value === 'error' ? 'error' : 'loading'
  }

  if (!connection.value) {
    return 'disconnected'
  }

  return connection.value.status === 'active' ? 'connected' : 'needs_reauth'
})

const capabilityLabels = computed<string[]>(() => {
  return (connection.value?.capabilities ?? []).flatMap((capability) => {
    const label = CAPABILITY_LABELS[capability]

    return label ? [label] : []
  })
})

async function handleConnectResult() {
  const result = route.query[GOOGLE_CONNECT_RESULT_QUERY_KEY]

  if (!isGoogleConnectResult(result)) {
    return
  }

  reportGoogleConnectResult('besidka', result)

  if (result === 'connected') {
    await refresh()
  }

  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => {
      return key !== GOOGLE_CONNECT_RESULT_QUERY_KEY
    }),
  )

  await navigateTo({ query }, { replace: true })
}

async function retry() {
  await refresh()
}

async function connect() {
  isBusy.value = true

  try {
    const { authorizationUrl } = await $fetch('/api/v1/google/oauth/start', {
      method: 'POST',
      body: { returnTo: GOOGLE_CONNECT_KEYS_RETURN_PATH },
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

function disconnectSubtitle(): string {
  const lines = [
    'Besidka removes its access at Google, and the Google Drive files '
    + 'copied into Besidka will be deleted. This also happens whenever '
    + 'Google access ends.',
  ]

  if (data.value?.dedicatedClient === false) {
    lines.push('Google will ask for your consent again the next time you '
      + 'use Sign in with Google.')
  }

  return lines.join(' ')
}

async function focusAfterDisconnect() {
  await nextTick()

  const target = connectButton.value ?? heading.value

  target?.focus()
}

function reportDisconnect(result: {
  revoked: boolean
  filesPending: boolean
}) {
  const copies = result.filesPending
    ? 'The copied Google Drive files are being deleted; this finishes '
    + 'shortly.'
    : 'The copied Google Drive files were deleted.'

  useSuccessMessage('Google Drive disconnected', copies)

  if (!result.revoked) {
    useErrorMessage(
      'Google did not confirm that Besidka\'s access was removed',
      `Remove Besidka yourself at ${GOOGLE_THIRD_PARTY_ACCESS_URL}`,
    )
  }

  announcement.value = 'Google Drive disconnected.'
}

async function disconnect() {
  const confirmation = await useConfirm({
    text: 'Disconnect Google Drive?',
    subtitle: disconnectSubtitle(),
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

    await refresh()
    reportDisconnect(result)
    isBusy.value = false
    await focusAfterDisconnect()
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
