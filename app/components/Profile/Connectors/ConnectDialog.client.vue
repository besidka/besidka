<template>
  <ProfileConnectorsDialog
    :title="dialogTitle"
    hook-class="js-connector-connect-modal"
    test-id="connector-connect-dialog"
    :is-busy="isBusy"
    @close="emit('close')"
  >
    <p
      class="sr-only"
      aria-live="polite"
      data-testid="connector-connect-live"
    >
      {{ liveMessage }}
    </p>

    <div
      v-if="identity"
      class="mb-4 flex items-center gap-3"
      data-testid="connector-connect-identity"
    >
      <ProfileConnectorsAvatar
        :title="identity.title"
        :preset-id="identity.presetId"
      />
      <div class="grid min-w-0 gap-0.5">
        <p class="break-all font-mono text-base font-semibold">
          {{ identity.host }}
        </p>
        <p class="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
          <span class="break-words">{{ identity.title }}</span>
          <span
            v-if="identity.isAddedByApp"
            class="badge badge-soft badge-warning badge-sm"
            data-testid="connector-connect-mcp-badge"
          >
            Added by a connected app
          </span>
        </p>
      </div>
    </div>

    <div
      v-if="step === 'discovering'"
      class="grid gap-2"
      aria-hidden="true"
      data-testid="connector-connect-loading"
    >
      <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
      <div class="skeleton skeleton--default h-4 w-1/2 rounded-full" />
    </div>

    <div
      v-else-if="step === 'failed'"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="connector-connect-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <div class="grid gap-1">
        <p class="font-medium">
          {{ errorTitle }}
        </p>
        <p
          v-if="errorDetail"
          class="text-sm"
        >
          {{ errorDetail }}
        </p>
        <NuxtLink
          v-if="errorLink"
          :to="errorLink"
          class="link text-sm"
          data-testid="connector-connect-error-link"
        >
          Open Labs
        </NuxtLink>
        <button
          v-if="canOfferToken"
          type="button"
          class="btn btn-sm btn-soft justify-self-start min-h-11 sm:min-h-8"
          data-testid="connector-connect-use-token"
          @click="useTokenInstead"
        >
          Use a token instead
        </button>
      </div>
    </div>

    <div
      v-else-if="step === 'consent' && discovery"
      class="grid gap-3"
    >
      <p
        v-if="discovery.notice"
        class="text-sm text-base-content/70"
        data-testid="connector-connect-notice"
      >
        {{ discovery.notice }}
      </p>
      <ProfileConnectorsConsentText
        v-model:accepted="isConsentAccepted"
        :host="discovery.host"
        :issuer-host="discovery.issuerHost"
        :is-disabled="isBusy"
      />
      <section
        class="grid gap-2"
        aria-labelledby="connector-connect-mode-heading"
        data-testid="connector-connect-mode"
      >
        <h3
          id="connector-connect-mode-heading"
          class="font-medium"
        >
          How the model gets its tools
        </h3>
        <div
          class="join w-full"
          role="radiogroup"
          aria-labelledby="connector-connect-mode-heading"
        >
          <input
            v-for="mode in CONNECTOR_TOOL_MODES"
            :key="mode"
            v-model="selectedToolMode"
            type="radio"
            name="connector-connect-mode"
            class="join-item btn btn-sm min-h-11 flex-1 sm:min-h-8"
            :class="{
              [SELECTED_MODE_CLASS]: selectedToolMode === mode,
            }"
            :value="mode"
            :aria-label="CONNECTOR_TOOL_MODE_LABELS[mode]"
            :disabled="isBusy"
            :data-testid="`connector-connect-mode-${mode}`"
          >
        </div>
        <p
          class="text-xs text-base-content/70"
          data-testid="connector-connect-mode-hint"
        >
          {{ CONNECTOR_TOOL_MODE_DESCRIPTIONS[selectedToolMode] }}
        </p>
      </section>
    </div>

    <div
      v-else-if="step === 'auth' && discovery"
      class="grid gap-3"
    >
      <template v-if="authKind === 'oauth'">
        <p class="text-sm">
          Sign in to {{ discovery.issuerHost ?? discovery.host }} to let
          Besidka use this server for you. You come back here afterwards.
        </p>
        <p
          v-if="!oauthFeature.active"
          class="text-sm text-base-content/70"
          data-testid="connector-connect-oauth-off"
        >
          Sign-in for connectors is not available on your account yet.
        </p>
      </template>

      <form
        v-else-if="authKind === 'header'"
        id="connector-connect-header-form"
        class="grid gap-3"
        novalidate
        data-testid="connector-connect-header-form"
        @submit.prevent="saveHeader"
      >
        <p class="text-sm">
          {{ headerIntro }}
        </p>
        <section
          class="grid gap-2"
          aria-labelledby="connector-header-kind-heading"
          data-testid="connector-header-kind"
        >
          <h3
            id="connector-header-kind-heading"
            class="text-sm font-medium"
          >
            How to send it
          </h3>
          <div
            class="join w-full"
            role="radiogroup"
            aria-labelledby="connector-header-kind-heading"
          >
            <input
              v-for="kind in CONNECTOR_HEADER_AUTH_KINDS"
              :key="kind"
              v-model="headerAuthKind"
              type="radio"
              name="connector-header-kind"
              class="join-item btn btn-sm min-h-11 flex-1 sm:min-h-8"
              :class="{
                [SELECTED_MODE_CLASS]: headerAuthKind === kind,
              }"
              :value="kind"
              :aria-label="HEADER_AUTH_KIND_LABELS[kind]"
              :disabled="isBusy"
              :data-testid="`connector-header-kind-${kind}`"
            >
          </div>
        </section>
        <div
          v-if="headerAuthKind === 'header'"
          class="grid gap-1"
        >
          <label
            for="connector-header-name"
            class="text-sm font-medium"
          >
            Header name
          </label>
          <input
            id="connector-header-name"
            v-model="headerName"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="64"
            class="input w-full"
            :disabled="isBusy"
            data-testid="connector-header-name"
          >
        </div>
        <div class="grid gap-1">
          <label
            for="connector-header-value"
            class="text-sm font-medium"
          >
            {{ headerAuthKind === 'bearer' ? 'API key or token' : 'Value' }}
          </label>
          <label class="input w-full">
            <input
              id="connector-header-value"
              v-model="headerValue"
              type="password"
              autocomplete="off"
              class="grow"
              :placeholder="headerValuePlaceholder"
              :aria-invalid="!!headerError"
              :aria-describedby="headerError
                ? 'connector-header-error'
                : 'connector-header-help'"
              :disabled="isBusy"
              data-testid="connector-header-value"
            >
            <UiFormPasteButton
              :disabled="isBusy"
              data-testid="connector-header-paste"
              @paste="pasteHeaderValue"
            />
          </label>
          <p
            v-if="headerError"
            id="connector-header-error"
            class="text-sm text-error"
            role="alert"
            data-testid="connector-header-error"
          >
            {{ headerError }}
          </p>
          <template v-else>
            <p
              id="connector-header-help"
              class="text-xs text-base-content/70"
              data-testid="connector-header-hint"
            >
              {{ headerHint }}
            </p>
            <p class="text-xs text-base-content/70">
              Stored encrypted and sent only to {{ discovery.host }}. Besidka
              never shows it again.
            </p>
          </template>
        </div>
      </form>

      <button
        v-if="authKind === 'oauth' && canUseHeader"
        type="button"
        class="link link-hover justify-self-start text-sm"
        :disabled="isBusy"
        data-testid="connector-connect-use-header"
        @click="authKind = 'header'"
      >
        Use an API key instead
      </button>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-ghost min-h-11 sm:min-h-8"
        :disabled="isBusy"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        v-if="step === 'failed'"
        type="button"
        class="btn btn-primary min-h-11 sm:min-h-8"
        data-testid="connector-connect-retry"
        @click="discover"
      >
        Try again
      </button>
      <button
        v-else-if="step === 'consent'"
        type="button"
        class="btn btn-primary min-h-11 sm:min-h-8"
        :disabled="isBusy || !isConsentAccepted"
        data-testid="connector-consent-continue"
        @click="giveConsent"
      >
        Agree and continue
      </button>
      <button
        v-else-if="step === 'auth' && authKind === 'oauth'"
        type="button"
        class="btn btn-primary min-h-11 sm:min-h-8"
        :disabled="isBusy || !oauthFeature.active"
        data-testid="connector-connect-sign-in"
        @click="startSignIn"
      >
        <span
          v-if="isBusy"
          class="loading loading-spinner loading-xs"
          aria-hidden="true"
        />
        Sign in
      </button>
      <button
        v-else-if="step === 'auth' && authKind === 'header'"
        type="submit"
        form="connector-connect-header-form"
        class="btn btn-primary min-h-11 sm:min-h-8"
        :disabled="isBusy || !isHeaderFormComplete"
        data-testid="connector-header-save"
      >
        Save and connect
      </button>
    </template>
  </ProfileConnectorsDialog>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  CONNECTOR_CONSENT_VERSION,
  CONNECTOR_NEW_TOOL_MODE,
  CONNECTOR_TOOL_MODE_DESCRIPTIONS,
  CONNECTOR_TOOL_MODE_LABELS,
  CONNECTOR_TOOL_MODES,
} from '#shared/utils/connectors-policy'
import {
  CONNECTOR_BEARER_HEADER_NAME,
  CONNECTOR_HEADER_AUTH_KINDS,
  resolveHeaderAuthDefault,
} from '#shared/utils/connectors-auth'
import type {
  ConnectorHeaderAuthInput,
  ConnectorHeaderAuthKind,
} from '#shared/utils/connectors-auth'
import type {
  ConnectorAuthType,
  ConnectorToolMode,
} from '#shared/utils/connectors-policy'
import { findConnectorPreset } from '~~/config/connectors-catalog'

const SELECTED_MODE_CLASS = 'btn-soft btn-soft-selected font-semibold '
  + '[--btn-color:var(--color-base-content)]'

const HEADER_AUTH_KIND_LABELS: Record<ConnectorHeaderAuthKind, string> = {
  bearer: 'API key or token',
  header: 'Custom header',
}

const BEARER_HINT = 'Besidka sends it as Authorization: Bearer followed by '
  + 'your key. A leading "Bearer " in what you paste is removed.'

const CUSTOM_HEADER_HINT = 'Sent exactly as typed. For Authorization, '
  + 'include the scheme, for example Bearer <token>.'

type ConnectStep = 'discovering' | 'consent' | 'auth' | 'failed'

interface Discovery {
  authType: ConnectorAuthType
  host: string
  issuerHost: string | null
  notice: string | null
  title: string | null
  presetId: string | null
  headerNames: string[]
}

const props = defineProps<{
  connectorId?: string
  draft?: ConnectorDraft
}>()

const emit = defineEmits<{
  connected: [connectorId: string]
  close: []
}>()

const oauthFeature = useFeature('connectors.oauth')
const connector = useConnectorById(() => props.connectorId ?? '')
const step = shallowRef<ConnectStep>('discovering')
const discovery = shallowRef<Discovery | null>(null)
const authKind = shallowRef<ConnectorAuthType>('none')
const isConsentAccepted = shallowRef<boolean>(false)
const selectedToolMode = shallowRef<ConnectorToolMode>(
  CONNECTOR_NEW_TOOL_MODE,
)
const isBusy = shallowRef<boolean>(false)
const errorTitle = shallowRef<string>('')
const errorDetail = shallowRef<string>('')
const errorCode = shallowRef<string>('')
const errorLink = shallowRef<string>('')
const liveMessage = shallowRef<string>('')
const headerAuthKind = shallowRef<ConnectorHeaderAuthKind>('bearer')
const headerName = shallowRef<string>(CONNECTOR_BEARER_HEADER_NAME)
const headerValue = shallowRef<string>('')
const headerError = shallowRef<string>('')

const identity = computed(() => {
  const current = connector.value

  if (current) {
    return {
      title: current.title,
      host: current.host,
      presetId: current.presetId,
      isAddedByApp: current.createdVia === 'mcp',
    }
  }

  const found = discovery.value

  if (!props.draft || !found) {
    return null
  }

  return {
    title: found.title ?? found.host,
    host: found.host,
    presetId: found.presetId,
    isAddedByApp: false,
  }
})

const preset = computed(() => {
  const presetId = identity.value?.presetId

  return presetId ? findConnectorPreset(presetId) ?? null : null
})

const canUseHeader = computed<boolean>(() => {
  return !preset.value || preset.value.auth.includes('header')
})

const TOKEN_FALLBACK_ERROR_CODES: readonly string[] = [
  'CONNECTOR_OAUTH_NO_REGISTRATION',
  'CONNECTOR_OAUTH_REDIRECT_NOT_ALLOWED',
]

const canOfferToken = computed<boolean>(() => {
  return step.value === 'failed'
    && TOKEN_FALLBACK_ERROR_CODES.includes(errorCode.value ?? '')
    && discovery.value !== null
    && canUseHeader.value
})

const dialogTitle = computed<string>(() => {
  const current = identity.value

  if (!current) {
    return 'Connect'
  }

  return current.isAddedByApp
    ? `Connect ${current.host}`
    : `Connect ${current.title}`
})

const isHeaderFormComplete = computed<boolean>(() => {
  if (headerAuthKind.value === 'bearer') {
    return !!headerValue.value.trim()
  }

  return !!headerName.value.trim() && !!headerValue.value
})

const headerHint = computed<string>(() => {
  return headerAuthKind.value === 'bearer' ? BEARER_HINT : CUSTOM_HEADER_HINT
})

const headerValuePlaceholder = computed<string>(() => {
  if (headerAuthKind.value === 'bearer') {
    return 'Paste the key'
  }

  return headerName.value.trim().toLowerCase() === 'authorization'
    ? 'Bearer your-token'
    : ''
})

const headerIntro = computed<string>(() => {
  if (preset.value?.id === 'github') {
    return 'Paste a fine-grained personal access token with the fewest '
      + 'permissions you need.'
  }

  return 'This server takes an API key or token in a request header.'
})

function fail(exception: unknown, fallback: string) {
  const parsedException = parseError(exception)

  errorTitle.value = parsedException.message || fallback
  errorCode.value = parsedException.code ?? ''
  errorLink.value = typeof parsedException.link === 'string'
    && /^\/(?![/\\])/.test(parsedException.link)
    ? parsedException.link
    : ''
  errorDetail.value = [parsedException.why, parsedException.fix]
    .filter(Boolean)
    .join('. ')
  step.value = 'failed'
  liveMessage.value = errorTitle.value
}

function isConsentCurrentFor(found: Discovery): boolean {
  const current = connector.value

  if (props.draft) {
    return false
  }

  if (!current || current.consent.state !== 'current') {
    return false
  }

  return found.authType !== 'oauth'
    || current.consent.issuerHost === found.issuerHost
}

function applyHeaderAuthDefault() {
  const declaredNames = preset.value?.headerName
    ? [preset.value.headerName]
    : discovery.value?.headerNames ?? []
  const fallback = resolveHeaderAuthDefault(declaredNames)

  headerAuthKind.value = fallback.kind
  headerName.value = fallback.name
  headerValue.value = ''
}

function pasteHeaderValue(text: string) {
  headerValue.value = text
  headerError.value = ''
}

function headerAuthInput(): ConnectorHeaderAuthInput {
  if (headerAuthKind.value === 'bearer') {
    return { kind: 'bearer', token: headerValue.value }
  }

  return {
    kind: 'header',
    name: headerName.value.trim(),
    value: headerValue.value,
  }
}

watch(headerAuthKind, () => {
  headerValue.value = ''
  headerError.value = ''
})

function useTokenInstead() {
  authKind.value = 'header'
  applyHeaderAuthDefault()
  errorCode.value = ''
  step.value = 'auth'
  liveMessage.value = 'Enter the key to finish connecting'
}

async function finish(connectedId: string) {
  await refreshConnectors()
  liveMessage.value = 'Connector connected'
  useSuccessMessage(`${identity.value?.title ?? 'Connector'} connected`)
  emit('connected', connectedId)
}

function consentBody(found: Discovery) {
  return {
    accepted: true,
    version: CONNECTOR_CONSENT_VERSION,
    issuerHost: found.issuerHost,
  }
}

async function createConnector(
  found: Discovery,
  auth?: ConnectorHeaderAuthInput,
) {
  const result = await $fetch('/api/v1/connectors', {
    method: 'POST',
    body: {
      ...props.draft,
      toolMode: selectedToolMode.value,
      consent: consentBody(found),
      ...(auth ? { auth } : {}),
    },
  })

  await finish(result.connector.id)
}

async function enterAuthStep(found: Discovery) {
  if (found.authType === 'none') {
    if (props.draft) {
      await createConnector(found)

      return
    }

    await finish(props.connectorId!)

    return
  }

  authKind.value = found.authType
  applyHeaderAuthDefault()
  step.value = 'auth'
  liveMessage.value = found.authType === 'oauth'
    ? 'Sign in to finish connecting'
    : 'Enter the key to finish connecting'
}

async function discoverDraft(draft: ConnectorDraft): Promise<Discovery> {
  const result = await $fetch('/api/v1/connectors/connect/discover', {
    method: 'POST',
    body: draft,
  })

  return {
    authType: result.authType,
    host: result.host,
    issuerHost: result.issuerHost,
    notice: result.notice,
    title: result.title,
    presetId: result.presetId,
    headerNames: result.headerNames,
  }
}

async function discoverExisting(connectorId: string): Promise<Discovery> {
  const result = await $fetch(
    `/api/v1/connectors/${connectorId}/connect/discover`,
    { method: 'POST' },
  )

  return {
    authType: result.authType,
    host: result.host,
    issuerHost: result.issuerHost,
    notice: result.notice,
    title: null,
    presetId: null,
    headerNames: [],
  }
}

async function discover() {
  step.value = 'discovering'
  liveMessage.value = 'Checking the server'

  try {
    const found = props.draft
      ? await discoverDraft(props.draft)
      : await discoverExisting(props.connectorId!)

    discovery.value = found

    if (isConsentCurrentFor(found)) {
      await enterAuthStep(found)

      return
    }

    selectedToolMode.value = connector.value?.toolMode
      ?? CONNECTOR_NEW_TOOL_MODE
    step.value = 'consent'
    liveMessage.value = 'Review the consent before you connect'
  } catch (exception) {
    fail(exception, 'Could not reach the server')
  }
}

async function applyToolMode(): Promise<boolean> {
  if (connector.value?.toolMode === selectedToolMode.value) {
    return true
  }

  try {
    await $fetch(`/api/v1/connectors/${props.connectorId}`, {
      method: 'PATCH',
      body: { toolMode: selectedToolMode.value },
    })
    await refreshConnectors()

    return true
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Could not change how the model gets the tools',
      parsedException.why,
    )

    return false
  }
}

async function giveConsent() {
  const found = discovery.value

  if (!found || !isConsentAccepted.value) {
    return
  }

  isBusy.value = true

  try {
    if (props.draft) {
      await enterAuthStep(found)

      return
    }

    const isModeApplied = await applyToolMode()

    if (!isModeApplied) {
      return
    }

    await $fetch(`/api/v1/connectors/${props.connectorId}/consent`, {
      method: 'POST',
      body: consentBody(found),
    })
    await refreshConnectors()
    await enterAuthStep(found)
  } catch (exception) {
    fail(exception, 'Could not save the consent')
  } finally {
    isBusy.value = false
  }
}

async function startSignIn() {
  const found = discovery.value

  isBusy.value = true

  try {
    const result = props.draft && found
      ? await $fetch('/api/v1/connectors/oauth/start', {
        method: 'POST',
        body: {
          ...props.draft,
          toolMode: selectedToolMode.value,
          consent: consentBody(found),
        },
      })
      : await $fetch(
        `/api/v1/connectors/${props.connectorId}/oauth/start`,
        { method: 'POST' },
      )
    const target = new URL(result.authorizationUrl)

    if (target.protocol !== 'https:') {
      throw new Error('The sign-in address is not https')
    }

    liveMessage.value = 'Opening the sign-in page'
    window.location.assign(target.toString())
  } catch (exception) {
    isBusy.value = false
    fail(exception, 'Could not start the sign-in')
  }
}

async function saveHeader() {
  headerError.value = ''
  isBusy.value = true

  try {
    if (props.draft && discovery.value) {
      await createConnector(discovery.value, headerAuthInput())
      headerValue.value = ''

      return
    }

    await $fetch(`/api/v1/connectors/${props.connectorId}/credentials`, {
      method: 'POST',
      body: { auth: headerAuthInput() },
    })
    headerValue.value = ''
    await finish(props.connectorId!)
  } catch (exception) {
    const parsedException = parseError(exception)

    headerError.value = [
      parsedException.message || 'Could not save the key',
      parsedException.fix,
    ].filter(Boolean).join('. ')
  } finally {
    isBusy.value = false
  }
}

onMounted(discover)
</script>
