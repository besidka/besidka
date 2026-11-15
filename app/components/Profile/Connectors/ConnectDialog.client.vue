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
      v-if="connector"
      class="mb-4 flex items-center gap-3"
      data-testid="connector-connect-identity"
    >
      <ProfileConnectorsAvatar :title="connector.title" />
      <div class="grid min-w-0 gap-0.5">
        <p class="break-all font-mono text-base font-semibold">
          {{ connector.host }}
        </p>
        <p class="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
          <span class="break-words">{{ connector.title }}</span>
          <span
            v-if="connector.createdVia === 'mcp'"
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
        <div class="grid gap-1">
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
            Value
          </label>
          <input
            id="connector-header-value"
            v-model="headerValue"
            type="password"
            autocomplete="off"
            class="input w-full"
            :placeholder="headerName.toLowerCase() === 'authorization'
              ? 'Bearer your-token'
              : ''"
            :aria-invalid="!!headerError"
            :aria-describedby="headerError
              ? 'connector-header-error'
              : 'connector-header-help'"
            :disabled="isBusy"
            data-testid="connector-header-value"
          >
          <p
            v-if="headerError"
            id="connector-header-error"
            class="text-sm text-error"
            role="alert"
            data-testid="connector-header-error"
          >
            {{ headerError }}
          </p>
          <p
            v-else
            id="connector-header-help"
            class="text-xs text-base-content/70"
          >
            Stored encrypted and sent only to {{ discovery.host }}. Besidka
            never shows it again.
          </p>
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
        :disabled="isBusy || !headerName.trim() || !headerValue"
        data-testid="connector-header-save"
      >
        Save and connect
      </button>
    </template>
  </ProfileConnectorsDialog>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import type { ConnectorAuthType } from '#shared/utils/connectors-policy'
import { findConnectorPreset } from '~~/config/connectors-catalog'

type ConnectStep = 'discovering' | 'consent' | 'auth' | 'failed'

interface Discovery {
  authType: ConnectorAuthType
  host: string
  issuerHost: string | null
  notice: string | null
}

const props = defineProps<{
  connectorId: string
}>()

const emit = defineEmits<{
  connected: [connectorId: string]
  close: []
}>()

const oauthFeature = useFeature('connectors.oauth')
const connector = useConnectorById(() => props.connectorId)
const step = shallowRef<ConnectStep>('discovering')
const discovery = shallowRef<Discovery | null>(null)
const authKind = shallowRef<ConnectorAuthType>('none')
const isConsentAccepted = shallowRef<boolean>(false)
const isBusy = shallowRef<boolean>(false)
const errorTitle = shallowRef<string>('')
const errorDetail = shallowRef<string>('')
const errorCode = shallowRef<string>('')
const liveMessage = shallowRef<string>('')
const headerName = shallowRef<string>('Authorization')
const headerValue = shallowRef<string>('')
const headerError = shallowRef<string>('')

const preset = computed(() => {
  const presetId = connector.value?.presetId

  return presetId ? findConnectorPreset(presetId) ?? null : null
})

const canUseHeader = computed<boolean>(() => {
  return !preset.value || preset.value.auth.includes('header')
})

const canOfferToken = computed<boolean>(() => {
  return step.value === 'failed'
    && errorCode.value === 'CONNECTOR_OAUTH_NO_REGISTRATION'
    && discovery.value !== null
    && canUseHeader.value
})

const dialogTitle = computed<string>(() => {
  const current = connector.value

  if (!current) {
    return 'Connect'
  }

  return current.createdVia === 'mcp'
    ? `Connect ${current.host}`
    : `Connect ${current.title}`
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
  errorDetail.value = [parsedException.why, parsedException.fix]
    .filter(Boolean)
    .join('. ')
  step.value = 'failed'
  liveMessage.value = errorTitle.value
}

function isConsentCurrentFor(found: Discovery): boolean {
  const current = connector.value

  if (!current || current.consent.state !== 'current') {
    return false
  }

  return found.authType !== 'oauth'
    || current.consent.issuerHost === found.issuerHost
}

function useTokenInstead() {
  authKind.value = 'header'
  headerName.value = preset.value?.headerName ?? 'Authorization'
  errorCode.value = ''
  step.value = 'auth'
  liveMessage.value = 'Enter the key to finish connecting'
}

async function finish() {
  await refreshConnectors()
  liveMessage.value = 'Connector connected'
  useSuccessMessage(`${connector.value?.title ?? 'Connector'} connected`)
  emit('connected', props.connectorId)
}

async function enterAuthStep(found: Discovery) {
  if (found.authType === 'none') {
    await finish()

    return
  }

  authKind.value = found.authType
  headerName.value = preset.value?.headerName ?? 'Authorization'
  step.value = 'auth'
  liveMessage.value = found.authType === 'oauth'
    ? 'Sign in to finish connecting'
    : 'Enter the key to finish connecting'
}

async function discover() {
  step.value = 'discovering'
  liveMessage.value = 'Checking the server'

  try {
    const result = await $fetch(
      `/api/v1/connectors/${props.connectorId}/connect/discover`,
      { method: 'POST' },
    )
    const found: Discovery = {
      authType: result.authType,
      host: result.host,
      issuerHost: result.issuerHost,
      notice: result.notice,
    }

    discovery.value = found

    if (isConsentCurrentFor(found)) {
      await enterAuthStep(found)

      return
    }

    step.value = 'consent'
    liveMessage.value = 'Review the consent before you connect'
  } catch (exception) {
    fail(exception, 'Could not reach the server')
  }
}

async function giveConsent() {
  const found = discovery.value

  if (!found || !isConsentAccepted.value) {
    return
  }

  isBusy.value = true

  try {
    await $fetch(`/api/v1/connectors/${props.connectorId}/consent`, {
      method: 'POST',
      body: {
        accepted: true,
        version: CONNECTOR_CONSENT_VERSION,
        issuerHost: found.issuerHost,
      },
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
  isBusy.value = true

  try {
    const result = await $fetch(
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
    await $fetch(`/api/v1/connectors/${props.connectorId}/credentials`, {
      method: 'POST',
      body: {
        headerName: headerName.value.trim(),
        headerValue: headerValue.value,
      },
    })
    headerValue.value = ''
    await finish()
  } catch (exception) {
    const parsedException = parseError(exception)

    headerError.value = parsedException.message || 'Could not save the key'
  } finally {
    isBusy.value = false
  }
}

onMounted(discover)
</script>
