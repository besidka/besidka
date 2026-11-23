<template>
  <section
    v-if="byo"
    class="grid min-w-0 gap-4 p-4 sm:p-6"
    aria-labelledby="google-byo-heading"
    data-testid="google-byo"
  >
    <div class="flex flex-wrap items-center gap-3">
      <Icon
        name="lucide:key-round"
        size="20"
        class="shrink-0"
      />
      <h3
        id="google-byo-heading"
        ref="heading"
        tabindex="-1"
        class="text-lg font-bold"
      >
        Your own Google OAuth client
      </h3>
      <span
        v-if="connectionState === 'connected'"
        class="badge badge-soft badge-success badge-sm gap-1"
        data-testid="google-byo-status"
      >
        <Icon
          name="lucide:circle-check"
          size="12"
        />
        <span class="max-xs:sr-only">Connected</span>
      </span>
      <span
        v-else-if="connectionState === 'needs_reauth'"
        class="badge badge-soft badge-warning badge-sm gap-1"
        data-testid="google-byo-status"
      >
        <Icon
          name="lucide:circle-alert"
          size="12"
        />
        <span class="max-xs:sr-only">Reconnect needed</span>
      </span>
    </div>
    <p
      class="sr-only"
      aria-live="polite"
      data-testid="google-byo-announcement"
    >
      {{ announcement }}
    </p>
    <p
      class="text-sm text-base-content/70"
      data-testid="google-byo-explainer"
    >
      This is for the owner of this Besidka instance. You connect Google
      through an OAuth client from your own Google Cloud project. That
      project, its consent screen and its verification status are your
      responsibility.
    </p>
    <template v-if="byo.canManage">
      <p
        v-if="reduced"
        class="text-sm"
        data-testid="google-byo-connectors-line"
      >
        Connect Gmail, Google Calendar and whole-Drive search on the
        <NuxtLink
          :to="GOOGLE_CONNECTORS_PATH"
          class="link"
          data-testid="google-byo-connectors-link"
        >
          Connectors page</NuxtLink>.
      </p>
      <div class="min-w-0">
        <UiFormFieldLabel label="Redirect URI to register on your client" />
        <div class="flex items-center gap-2">
          <code
            class="min-w-0 flex-1 break-all rounded-box bg-base-200 px-3 py-2
              text-xs"
            data-testid="google-byo-redirect-uri"
          >{{ byo.redirectUri }}</code>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="Copy the redirect URI"
            data-testid="google-byo-copy-redirect"
            @click="copyRedirectUri"
          >
            <Icon
              name="lucide:copy"
              size="16"
            />
          </button>
        </div>
      </div>
      <form
        novalidate
        data-testid="google-byo-client-form"
        @submit.prevent="saveClient"
      >
        <UiFormFieldset>
          <UiFormLabel class="[--radius-field:0.5rem]">
            <UiFormFieldLabel label="Client ID" />
            <label class="relative input w-full rounded-field">
              <span class="label">
                <Icon
                  name="lucide:id-card"
                  size="16"
                />
              </span>
              <input
                v-model="clientId"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="your-client-id.apps.googleusercontent.com"
                :disabled="isBusy"
                data-testid="google-byo-client-id"
              >
              <span class="label">
                <UiFormPasteButton
                  :disabled="isBusy"
                  @paste="pasteClientId"
                />
              </span>
            </label>
          </UiFormLabel>
          <UiFormLabel class="[--radius-field:0.5rem]">
            <UiFormFieldLabel label="Client secret" />
            <label class="relative input w-full rounded-field">
              <span class="label">
                <Icon
                  name="lucide:key-round"
                  size="16"
                />
              </span>
              <input
                v-model="clientSecret"
                type="password"
                autocomplete="new-password"
                spellcheck="false"
                :placeholder="byo.hasClient
                  ? 'Enter a new secret to replace the saved one'
                  : 'The client secret from the same client'"
                :disabled="isBusy"
                data-testid="google-byo-client-secret"
              >
              <span class="label">
                <UiFormPasteButton
                  :disabled="isBusy"
                  @paste="pasteClientSecret"
                />
              </span>
            </label>
            <p
              v-if="byo.hasClient"
              class="fieldset-label mt-2 flex-col items-start
                text-base-content/80"
              data-testid="google-byo-client-saved"
            >
              A client is saved. Its id and secret are never shown again;
              enter both values to replace them.
            </p>
          </UiFormLabel>
          <div
            v-if="saveError"
            role="alert"
            class="alert alert-soft alert-error text-sm"
            data-testid="google-byo-save-error"
          >
            <Icon
              name="lucide:circle-alert"
              size="16"
              class="shrink-0"
            />
            <p>{{ saveError }}</p>
          </div>
          <div class="max-md:grid md:flex md:place-content-end gap-2">
            <UiButton
              v-if="byo.hasClient"
              mode="error"
              text="Delete"
              title="Delete client"
              icon-name="lucide:trash"
              :disabled="isBusy"
              class="w-full"
              outline
              data-testid="google-byo-delete"
              @click="deleteClient"
            />
            <UiButton
              type="submit"
              text="Save"
              title="Save client"
              icon-name="lucide:cloud-upload"
              :disabled="isBusy || !canSaveClient"
              class="w-full"
              data-testid="google-byo-save"
            />
          </div>
        </UiFormFieldset>
      </form>
    </template>
    <template v-else>
      <p
        class="text-sm text-base-content/70"
        data-testid="google-byo-not-owner"
      >
        Only the instance owner can use this client. You can still remove
        what is left of it.
      </p>
      <div
        v-if="byo.hasClient"
        class="max-md:grid md:flex md:place-content-end gap-2"
      >
        <UiButton
          mode="error"
          text="Delete"
          title="Delete client"
          icon-name="lucide:trash"
          :disabled="isBusy"
          class="w-full"
          outline
          data-testid="google-byo-delete"
          @click="deleteClient"
        />
      </div>
    </template>
    <fieldset
      v-if="
        byo.canManage
          && !reduced
          && byo.hasClient
          && offeredOptions.length > 0
      "
      class="grid min-w-0 gap-2"
      data-testid="google-byo-capabilities-form"
    >
      <legend class="text-sm font-semibold">
        {{ connectionState === 'connected'
          ? 'Add access'
          : 'What Besidka may request' }}
      </legend>
      <p class="text-sm text-base-content/70">
        Nothing is ticked for you. Gmail read access lets the model search
        and read your mail when you allow it, Gmail drafts let it write
        drafts you approve (Gmail tools need Gmail turned on in Labs), and
        Google Drive read access lets it search your files and read the
        ones it finds.
        <template v-if="isCalendarActive">
          Google Calendar access lets it list events, check when you are
          busy and create one event you approve.
        </template>
        <template v-else>
          Google Calendar tools need Google Calendar turned on in Labs.
        </template>
        You can add more later; to remove access, disconnect and connect
        again.
      </p>
      <label
        v-for="option in offeredOptions"
        :key="option.id"
        class="flex items-start gap-2 text-sm"
        :class="option.nestedUnder ? 'ml-6' : undefined"
      >
        <input
          v-model="selectedCapabilities"
          type="checkbox"
          class="checkbox checkbox-sm"
          :value="option.id"
          :disabled="isBusy || isOptionLocked(option)"
          :data-testid="`google-byo-capability-${option.id}`"
        >
        <span>
          <Icon
            v-if="option.icon"
            :name="option.icon"
            size="16"
            class="mr-1 inline-block shrink-0 align-text-bottom"
            :data-testid="`google-byo-capability-${option.id}-icon`"
          />{{ option.label }}
          <span
            v-if="option.note"
            class="block text-xs text-base-content/60"
          >{{ option.note }}</span>
          <span
            v-if="isOptionLocked(option)"
            class="block text-xs text-base-content/60"
            :data-testid="`google-byo-capability-${option.id}-locked`"
          >{{ GOOGLE_DRIVE_WRITE_NEEDS_READ_HINT }}</span>
        </span>
      </label>
      <div class="max-md:grid md:flex md:place-content-end gap-2">
        <UiButton
          :text="connectButtonLabel"
          icon-name="lucide:plug"
          :disabled="isBusy || selectedCapabilities.length === 0"
          class="w-full"
          data-testid="google-byo-connect"
          @click="connect"
        />
      </div>
    </fieldset>
    <template v-if="connection && showsConnectionControls">
      <div
        v-if="connectionState === 'needs_reauth'"
        role="alert"
        class="alert alert-soft alert-warning text-sm"
        data-testid="google-byo-reauth-alert"
      >
        <Icon
          name="lucide:triangle-alert"
          size="16"
          class="shrink-0"
        />
        <p>Google no longer accepts access through your own client.</p>
      </div>
      <dl class="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <dt class="text-base-content/70">
          Google account
        </dt>
        <dd
          class="break-all"
          data-testid="google-byo-email"
        >
          {{ connection.email ?? 'Unknown account' }}
        </dd>
        <template v-if="grantedLabels.length > 0">
          <dt class="text-base-content/70">
            Google granted
          </dt>
          <dd>
            <ul
              class="grid gap-1"
              data-testid="google-byo-granted"
            >
              <li
                v-for="label in grantedLabels"
                :key="label"
              >
                {{ label }}
              </li>
            </ul>
          </dd>
        </template>
      </dl>
      <p
        v-if="connectionState === 'connected'"
        class="text-sm text-base-content/70"
        data-testid="google-byo-tools-hint"
      >
        {{ toolsHint }}
      </p>
      <p
        v-if="connectionState === 'connected' && isComposeGranted"
        class="text-sm text-base-content/70"
        data-testid="google-byo-compose-note"
      >
        {{ COMPOSE_SEND_NOTE }}
      </p>
      <p
        v-if="connectionState === 'connected' && isDriveWriteGranted"
        class="text-sm text-base-content/70"
        data-testid="google-byo-drive-write-note"
      >
        {{ GOOGLE_DRIVE_WRITE_SCOPE_NOTE }}
      </p>
      <div
        v-if="missingToolNotes.length > 0"
        class="alert alert-soft alert-info text-sm"
        data-testid="google-byo-missing-tools"
      >
        <Icon
          name="lucide:info"
          size="16"
          class="shrink-0"
        />
        <div>
          <p>Some tools are off because that access was not granted:</p>
          <ul class="mt-1 list-disc pl-5">
            <li
              v-for="note in missingToolNotes"
              :key="note"
            >
              {{ note }}
            </li>
          </ul>
        </div>
      </div>
      <div class="max-md:grid md:flex md:place-content-end gap-2">
        <UiButton
          mode="error"
          text="Disconnect"
          icon-name="lucide:unplug"
          :disabled="isBusy"
          class="w-full"
          outline
          data-testid="google-byo-disconnect"
          @click="disconnect"
        />
      </div>
    </template>
    <ProfileGoogleOwnClientGuide
      v-if="byo.canManage"
      :reduced="reduced"
    />
  </section>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  GOOGLE_BYO_RESULT_QUERY_KEY,
  isGoogleOAuthClientId,
  isGoogleOAuthClientSecret,
} from '#shared/utils/google-byo'
import type { GoogleByoCapability } from '#shared/utils/google-byo'
import { GOOGLE_CALENDAR_ICON } from '#shared/utils/google-brand-icons'
import { GOOGLE_CALENDAR_ACCESS_NOTE } from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_DRIVE_WRITE_ACCESS_NOTE,
  GOOGLE_DRIVE_WRITE_NEEDS_READ_HINT,
  GOOGLE_DRIVE_WRITE_SCOPE_NOTE,
  GOOGLE_DRIVE_WRITE_TOOLS_HINT,
  GOOGLE_DRIVE_WRITE_TOOLS_MISSING_NOTE,
} from '#shared/utils/google-drive-write'
import { getGoogleByoToolsHint } from '#shared/utils/google-gmail-tools'
import { GOOGLE_CONNECTORS_PATH } from '#shared/utils/google-connectors'
import {
  GOOGLE_CONNECT_KEYS_RETURN_PATH,
  GOOGLE_THIRD_PARTY_ACCESS_URL,
  isGoogleConnectResult,
} from '#shared/utils/google-connections'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionSummary,
  GooglePartialCalendarAccess,
} from '#shared/utils/google-connections'
import type { GoogleCapability } from '#shared/utils/google-scopes'
import { reportGoogleConnectResult } from '~/utils/google-connect-results'

type ConnectionState = 'none' | 'connected' | 'needs_reauth'

interface CapabilityOption {
  id: GoogleByoCapability
  label: string
  note?: string
  icon?: string
  nestedUnder?: GoogleByoCapability
}

const COMPOSE_SEND_NOTE = 'Google\'s gmail.compose permission technically '
  + 'also allows sending mail. Besidka only ever creates drafts: it has no '
  + 'code that sends mail.'

const GMAIL_CAPABILITIES: ReadonlySet<GoogleByoCapability> = new Set([
  'gmail-read',
  'gmail-compose',
])

const CAPABILITY_OPTIONS: CapabilityOption[] = [
  { id: 'drive-read', label: 'All your Google Drive files, read only' },
  {
    id: 'drive-write',
    label: 'Change files in Google Drive',
    note: `${GOOGLE_DRIVE_WRITE_ACCESS_NOTE} ${GOOGLE_DRIVE_WRITE_SCOPE_NOTE}`,
    nestedUnder: 'drive-read',
  },
  { id: 'gmail-read', label: 'Your Gmail, read only' },
  {
    id: 'gmail-compose',
    label: 'Gmail drafts',
    note: COMPOSE_SEND_NOTE,
  },
  {
    id: 'calendar',
    label: 'Your Google Calendar events',
    note: GOOGLE_CALENDAR_ACCESS_NOTE,
    icon: GOOGLE_CALENDAR_ICON,
  },
]

const MISSING_TOOL_NOTES: ReadonlyArray<{
  id: GoogleByoCapability
  note: string
}> = [
  {
    id: 'drive-write',
    note: GOOGLE_DRIVE_WRITE_TOOLS_MISSING_NOTE,
  },
  {
    id: 'gmail-read',
    note: 'Searching and reading Gmail needs Gmail read access.',
  },
  {
    id: 'gmail-compose',
    note: 'Writing Gmail drafts needs Gmail drafts access.',
  },
  {
    id: 'drive-read',
    note: 'Searching Google Drive and reading the files it finds needs '
      + 'Google Drive read access.',
  },
  {
    id: 'calendar',
    note: 'Reading and creating Google Calendar events and checking free '
      + 'and busy time needs Google Calendar access.',
  },
]

const PARTIAL_CALENDAR_NOTES: Readonly<
  Record<GooglePartialCalendarAccess, string>
> = {
  'events': 'Listing and creating Google Calendar events work. Checking '
    + 'when you are busy needs the second Google Calendar permission.',
  'free-busy': 'Checking when you are busy works. Listing and creating '
    + 'Google Calendar events needs the other Google Calendar permission.',
}

const GRANTED_LABELS: ReadonlyMap<GoogleCapability, string> = new Map(
  CAPABILITY_OPTIONS.map((option) => {
    return [option.id, option.label]
  }),
)

const props = withDefaults(defineProps<{
  reduced?: boolean
}>(), {
  reduced: false,
})

const route = useRoute()
const isBusy = shallowRef<boolean>(false)
const announcement = shallowRef<string>('')
const saveError = shallowRef<string>('')
const clientId = shallowRef<string>('')
const clientSecret = shallowRef<string>('')
const selectedCapabilities = ref<GoogleByoCapability[]>([])
const heading = useTemplateRef<HTMLElement>('heading')

const { data, refresh } = await useGoogleConnection()
const gmailFeature = useFeature('google.gmail')
const calendarFeature = useFeature('google.calendar')

const isGmailActive = computed<boolean>(() => {
  return gmailFeature.value.active
})

const isCalendarActive = computed<boolean>(() => {
  return calendarFeature.value.active
})

const byo = computed<GoogleByoConnectionStatus | null>(() => {
  return data.value?.byo ?? null
})

const connection = computed<GoogleConnectionSummary | null>(() => {
  return byo.value?.connection ?? null
})

const connectionState = computed<ConnectionState>(() => {
  if (!connection.value) {
    return 'none'
  }

  return connection.value.status === 'active' ? 'connected' : 'needs_reauth'
})

const grantedLabels = computed<string[]>(() => {
  return (connection.value?.capabilities ?? []).flatMap((capability) => {
    const label = GRANTED_LABELS.get(capability)

    return label ? [label] : []
  })
})

const grantedCapabilities = computed<GoogleByoCapability[]>(() => {
  if (connectionState.value !== 'connected') {
    return []
  }

  return CAPABILITY_OPTIONS
    .map(option => option.id)
    .filter((id) => {
      return connection.value?.capabilities.includes(id) === true
    })
})

const missingToolNotes = computed<string[]>(() => {
  if (connectionState.value !== 'connected') {
    return []
  }

  const partialCalendar = connection.value?.partialCalendar

  return MISSING_TOOL_NOTES
    .filter((item) => {
      return isGmailActive.value || !GMAIL_CAPABILITIES.has(item.id)
    })
    .filter((item) => {
      return isCalendarActive.value || item.id !== 'calendar'
    })
    .filter((item) => {
      return item.id !== 'drive-write'
        || grantedCapabilities.value.includes('drive-read')
    })
    .filter(item => !grantedCapabilities.value.includes(item.id))
    .map((item) => {
      return item.id === 'calendar' && partialCalendar
        ? PARTIAL_CALENDAR_NOTES[partialCalendar]
        : item.note
    })
})

const toolsHint = computed<string>(() => {
  const hint = getGoogleByoToolsHint(
    isGmailActive.value,
    isCalendarActive.value,
  )

  return isDriveWriteGranted.value
    ? `${hint} ${GOOGLE_DRIVE_WRITE_TOOLS_HINT}`
    : hint
})

const isComposeGranted = computed<boolean>(() => {
  return grantedCapabilities.value.includes('gmail-compose')
})

const isDriveWriteGranted = computed<boolean>(() => {
  return grantedCapabilities.value.includes('drive-write')
})

const isDriveReadAvailable = computed<boolean>(() => {
  return grantedCapabilities.value.includes('drive-read')
    || selectedCapabilities.value.includes('drive-read')
})

function isOptionLocked(option: CapabilityOption): boolean {
  return option.nestedUnder === 'drive-read' && !isDriveReadAvailable.value
}

const offeredOptions = computed<CapabilityOption[]>(() => {
  return CAPABILITY_OPTIONS.filter((option) => {
    return !grantedCapabilities.value.includes(option.id)
      && (isCalendarActive.value || option.id !== 'calendar')
  })
})

const requestedCapabilities = computed<GoogleByoCapability[]>(() => {
  return [
    ...new Set([
      ...grantedCapabilities.value,
      ...selectedCapabilities.value,
    ]),
  ].filter((id) => {
    return (isCalendarActive.value || id !== 'calendar')
      && (id !== 'drive-write' || isDriveReadAvailable.value)
  })
})

watch(isDriveReadAvailable, (isAvailable) => {
  if (isAvailable) {
    return
  }

  selectedCapabilities.value = selectedCapabilities.value.filter((id) => {
    return id !== 'drive-write'
  })
})

const connectButtonLabel = computed<string>(() => {
  if (connectionState.value === 'connected') {
    return 'Add access'
  }

  return connectionState.value === 'needs_reauth' ? 'Reconnect' : 'Connect'
})

const canSaveClient = computed<boolean>(() => {
  return isGoogleOAuthClientId(clientId.value.trim())
    && isGoogleOAuthClientSecret(clientSecret.value.trim())
})

const showsConnectionControls = computed<boolean>(() => {
  return !props.reduced || byo.value?.canManage !== true
})

async function handleConnectResult() {
  const result = route.query[GOOGLE_BYO_RESULT_QUERY_KEY]

  if (!isGoogleConnectResult(result)) {
    return
  }

  reportGoogleConnectResult('byo', result)

  if (result === 'connected' || result === 'partial') {
    await refresh()
  }

  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => {
      return key !== GOOGLE_BYO_RESULT_QUERY_KEY
    }),
  )

  await navigateTo({ query }, { replace: true })
}

function pasteClientId(text: string) {
  clientId.value = text
}

function pasteClientSecret(text: string) {
  clientSecret.value = text
}

async function copyRedirectUri() {
  if (!byo.value?.redirectUri) {
    return
  }

  try {
    await navigator.clipboard.writeText(byo.value.redirectUri)
    announcement.value = 'Redirect URI copied.'
    useSuccessMessage('Redirect URI copied')
  } catch (exception) {
    useErrorMessage(
      'The redirect URI could not be copied',
      exception instanceof Error ? exception.message : undefined,
    )
  }
}

async function saveClient() {
  if (!canSaveClient.value) {
    saveError.value = 'Enter a client id ending in '
      + '.apps.googleusercontent.com and its client secret.'

    return
  }

  isBusy.value = true
  saveError.value = ''

  try {
    const result = await $fetch('/api/v1/profiles/keys/google-oauth-client', {
      method: 'POST',
      body: {
        clientId: clientId.value.trim(),
        clientSecret: clientSecret.value.trim(),
      },
    })

    clientId.value = ''
    clientSecret.value = ''
    await refresh()
    useSuccessMessage(
      'Google OAuth client saved',
      result.connectionEnded
        ? 'The connection made with the previous client was ended.'
        : undefined,
    )
    announcement.value = 'Google OAuth client saved.'
  } catch (exception) {
    const parsedException = parseError(exception)

    saveError.value = parsedException.why
      ? `${parsedException.message}. ${parsedException.why}.`
      : parsedException.message || 'The client could not be saved.'
  } finally {
    isBusy.value = false
  }
}

async function deleteClient() {
  const confirmation = await useConfirm({
    text: 'Delete your Google OAuth client?',
    subtitle: 'Besidka deletes the saved client id and secret. A connection '
      + 'made with this client ends first, and Besidka removes its access '
      + 'at Google.',
    alert: true,
    actions: ['Delete'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  isBusy.value = true

  try {
    const result = await $fetch('/api/v1/profiles/keys/google-oauth-client', {
      method: 'DELETE',
    })

    await refresh()
    useSuccessMessage('Google OAuth client deleted')
    reportRevoke(result.connectionEnded, result.revoked)
    announcement.value = 'Google OAuth client deleted.'
    await focusHeading()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'The client could not be deleted',
      parsedException.why,
    )
  } finally {
    isBusy.value = false
  }
}

async function connect() {
  isBusy.value = true

  try {
    const { authorizationUrl } = await $fetch('/api/v1/google/byo/start', {
      method: 'POST',
      body: {
        capabilities: requestedCapabilities.value,
        returnTo: GOOGLE_CONNECT_KEYS_RETURN_PATH,
      },
    })

    await navigateTo(authorizationUrl, { external: true })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Google could not be connected',
      parsedException.why,
    )
    isBusy.value = false
  }
}

function reportRevoke(connectionEnded: boolean, revoked: boolean) {
  if (!connectionEnded || revoked) {
    return
  }

  useErrorMessage(
    'Google did not confirm that Besidka\'s access was removed',
    `Remove it yourself at ${GOOGLE_THIRD_PARTY_ACCESS_URL}`,
  )
}

async function focusHeading() {
  await nextTick()
  heading.value?.focus()
}

async function disconnect() {
  const confirmation = await useConfirm({
    text: 'Disconnect your own Google client?',
    subtitle: 'Besidka removes its access at Google and deletes the stored '
      + 'tokens. The saved client stays until you delete it.',
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
      body: { clientMode: 'byo' },
    })

    await refresh()
    useSuccessMessage('Google disconnected')
    reportRevoke(true, result.revoked)
    announcement.value = 'Google disconnected.'
    await focusHeading()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Google could not be disconnected',
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
