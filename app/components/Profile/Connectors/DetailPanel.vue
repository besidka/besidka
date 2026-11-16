<template>
  <div
    v-if="!connector"
    class="alert alert-info alert-soft my-4"
    role="status"
    data-testid="connector-detail-missing"
  >
    <span>This connector was deleted.</span>
  </div>
  <div
    v-else
    class="flex flex-col gap-5 py-4"
    data-testid="connector-detail"
  >
    <div class="flex items-start gap-3">
      <ProfileConnectorsAvatar
        :title="connector.title"
        :connector-id="connector.id"
        :preset-id="connector.presetId"
        :is-icon-available="hasConnectorIcon(connector)"
        size="lg"
      />
      <div class="grid min-w-0 gap-1">
        <p
          class="break-all text-sm"
          data-testid="connector-detail-host"
        >
          {{ connector.host }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="badge badge-soft badge-sm"
            :class="STATUS_BADGE_CLASS[status.tone]"
            data-testid="connector-detail-status"
          >
            {{ status.label }}
          </span>
          <span
            v-if="connector.createdVia === 'mcp'"
            class="badge badge-soft badge-warning badge-sm"
            data-testid="connector-detail-mcp-badge"
          >
            Added by a connected app
          </span>
          <span
            v-if="authLabel"
            class="text-xs text-base-content/70"
          >
            {{ authLabel }}
          </span>
        </div>
        <p
          v-if="connector.addedByApp"
          class="text-xs text-base-content/70"
          data-testid="connector-detail-added-by"
        >
          Added by {{ connector.addedByApp }}, not by you in the app. It
          stays off until you turn it on here.
        </p>
      </div>
    </div>

    <div
      v-if="connector.note && connector.status !== 'drifted'"
      class="alert alert-soft text-sm"
      :class="connector.status === 'error' ? 'alert-error' : 'alert-info'"
      role="status"
      data-testid="connector-detail-note"
    >
      <span>{{ connector.note.message }}</span>
    </div>

    <section
      class="grid gap-2"
      aria-label="Use in chats"
    >
      <label class="flex items-center justify-between gap-3">
        <span class="grid gap-0.5">
          <span class="font-medium">Use in chats</span>
          <span class="text-xs text-base-content/70">
            {{ enableHint }}
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle"
          :checked="connector.enabled"
          :disabled="isBusy || !canToggle"
          data-testid="connector-detail-toggle"
          @change="onToggleEnabled"
        >
      </label>
    </section>

    <section
      class="grid gap-2"
      aria-labelledby="connector-detail-mode-heading"
      data-testid="connector-detail-mode"
    >
      <h3
        id="connector-detail-mode-heading"
        class="font-medium"
      >
        How the model gets its tools
      </h3>
      <div
        class="join w-full"
        role="radiogroup"
        aria-labelledby="connector-detail-mode-heading"
      >
        <input
          v-for="mode in CONNECTOR_TOOL_MODES"
          :key="mode"
          type="radio"
          name="connector-detail-mode"
          class="join-item btn btn-sm min-h-11 flex-1 sm:min-h-8"
          :class="{
            'btn-soft btn-soft-selected btn-primary font-semibold':
              connector.toolMode === mode,
          }"
          :value="mode"
          :aria-label="CONNECTOR_TOOL_MODE_LABELS[mode]"
          :checked="connector.toolMode === mode"
          :disabled="isBusy"
          :data-testid="`connector-detail-mode-${mode}`"
          @change="setToolMode(mode)"
        >
      </div>
      <p
        class="text-xs text-base-content/70"
        data-testid="connector-detail-mode-hint"
      >
        {{ CONNECTOR_TOOL_MODE_DESCRIPTIONS[connector.toolMode] }}
      </p>
    </section>

    <section
      class="grid gap-2"
      aria-labelledby="connector-detail-consent-heading"
    >
      <h3
        id="connector-detail-consent-heading"
        class="font-medium"
      >
        Consent
      </h3>
      <p
        class="text-sm text-base-content/80"
        data-testid="connector-detail-consent"
      >
        {{ consentLine }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="connector.consent.state === 'current'"
          type="button"
          class="btn btn-sm btn-outline min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="connector-detail-withdraw"
          @click="withdrawConsent"
        >
          Withdraw consent
        </button>
      </div>
    </section>

    <section
      class="grid gap-3"
      aria-labelledby="connector-detail-tools-heading"
    >
      <div class="flex items-center justify-between gap-2">
        <h3
          id="connector-detail-tools-heading"
          class="font-medium"
        >
          Tools
        </h3>
        <button
          v-if="listing?.state === 'ok'"
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="isToolsLoading || isBusy"
          data-testid="connector-detail-tools-refresh"
          @click="loadTools()"
        >
          Refresh
        </button>
      </div>

      <div
        v-if="isToolsLoading && !listing"
        class="grid gap-2"
        aria-hidden="true"
        data-testid="connector-detail-tools-loading"
      >
        <div class="skeleton skeleton--default h-12 w-full" />
        <div class="skeleton skeleton--default h-12 w-full" />
      </div>
      <div
        v-else-if="toolsError"
        class="alert alert-error alert-soft"
        role="alert"
      >
        <span>{{ toolsError }}</span>
        <button
          type="button"
          class="btn btn-sm"
          @click="loadTools()"
        >
          Retry
        </button>
      </div>
      <div
        v-else-if="listing?.state === 'unavailable'"
        class="grid gap-2"
        data-testid="connector-detail-tools-unavailable"
      >
        <p class="text-sm text-base-content/70">
          {{ unavailableText }}
        </p>
        <button
          v-if="canConnectFromTools"
          type="button"
          class="btn btn-sm btn-primary justify-self-start min-h-11 sm:min-h-8"
          :disabled="isBusy"
          @click="connect.open(connector.id)"
        >
          Connect
        </button>
      </div>
      <template v-else-if="listing?.state === 'ok'">
        <ProfileConnectorsToolReview
          v-if="pendingTools.length || listing.removed.length"
          :tools="pendingTools"
          :removed="listing.removed"
          :is-first-review="!listing.isBaselined"
          :is-busy="isBusy"
          @decide="decide"
        />
        <ProfileConnectorsToolList
          v-if="listing.isBaselined"
          :tools="reviewedTools"
          :per-message-limit="listing.counts.perMessageLimit"
          :is-busy="isBusy"
          @set-modes="setToolModes"
        />
      </template>
    </section>

    <section
      class="grid gap-2 border-t border-base-300 pt-4"
      aria-label="Connector actions"
    >
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="connector-detail-connect"
          @click="connect.open(connector.id)"
        >
          {{ connector.status === 'needs-auth' ? 'Connect' : 'Reconnect' }}
        </button>
        <button
          v-if="connector.status !== 'needs-auth'"
          type="button"
          class="btn btn-sm min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="connector-detail-disconnect"
          @click="disconnect"
        >
          Disconnect
        </button>
        <button
          type="button"
          class="btn btn-sm btn-error btn-outline min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="connector-detail-delete"
          @click="remove"
        >
          Delete
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  ConnectorReviewTool,
  ConnectorToolsListing,
} from '#shared/types/connectors.d'
import {
  CONNECTOR_TOOL_MODE_DESCRIPTIONS,
  CONNECTOR_TOOL_MODE_LABELS,
  CONNECTOR_TOOL_MODES,
} from '#shared/utils/connectors-policy'
import type { ConnectorToolMode } from '#shared/utils/connectors-policy'
import type { ToolPermissionChange } from '~/utils/tool-permissions'

const TOOL_SETTINGS_PER_REQUEST = 40

const STATUS_BADGE_CLASS: Record<ConnectorStatusTone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
}

const CONNECT_CODES: ReadonlySet<string> = new Set([
  'CONNECTOR_NOT_READY',
  'CONNECTOR_CONSENT_REQUIRED',
  'CONNECTOR_REAUTH_REQUIRED',
  'CONNECTOR_REFRESH_FAILED',
])

const props = defineProps<{
  connectorId: string
}>()

const sidePanel = useSidePanel()
const connect = useConnectorConnect()
const connector = useConnectorById(() => props.connectorId)
const listing = shallowRef<ConnectorToolsListing | null>(null)
const isToolsLoading = shallowRef<boolean>(false)
const toolsError = shallowRef<string>('')
const isBusy = shallowRef<boolean>(false)

const status = computed<ConnectorStatusLabel>(() => {
  return connector.value
    ? getConnectorStatusLabel(connector.value)
    : { label: '', tone: 'neutral' }
})

const authLabel = computed<string>(() => {
  switch (connector.value?.authType) {
    case 'oauth':
      return 'Signed in with OAuth'
    case 'header':
      return 'API key or token'
    case 'none':
      return 'No sign-in'
    default:
      return ''
  }
})

const canToggle = computed<boolean>(() => {
  const current = connector.value

  if (!current) {
    return false
  }

  return current.enabled
    || (
      current.status === 'ready'
      && current.consent.state === 'current'
      && isReviewed.value
    )
})

const isReviewed = computed<boolean>(() => {
  return listing.value?.state === 'ok'
    && listing.value.isBaselined
    && listing.value.counts.pending === 0
})

const ENABLED_HINTS: Record<ConnectorToolMode, string> = {
  'manual': 'Turn it on in a chat\'s + menu to let the model use it.',
  'auto': 'Available in every chat. Switch it off for one chat in the + menu.',
  'always-on': 'Its tools go with every message. Switch it off for one chat in '
    + 'the + menu.',
}

const enableHint = computed<string>(() => {
  const current = connector.value

  if (!current || current.enabled) {
    return ENABLED_HINTS[current?.toolMode ?? 'manual']
  }

  if (current.status === 'drifted') {
    return 'Review the changed tools first.'
  }

  if (listing.value?.state === 'ok' && !isReviewed.value) {
    return 'Review the tools below first.'
  }

  if (current.status !== 'ready' || current.consent.state !== 'current') {
    return 'Connect it first.'
  }

  return 'Off: no chat can use it.'
})

const consentLine = computed<string>(() => {
  const current = connector.value

  if (!current) {
    return ''
  }

  const { consent } = current

  if (consent.state === 'current' && consent.givenAt) {
    const date = new Date(consent.givenAt).toLocaleDateString()
    const issuer = consent.issuerHost && consent.issuerHost !== current.host
      ? `, signing in through ${consent.issuerHost}`
      : ''

    return `You agreed on ${date} to send data to ${current.host}${issuer}.`
  }

  if (consent.state === 'withdrawn') {
    return 'You withdrew your consent. Nothing is sent to this server until '
      + 'you connect it again.'
  }

  if (consent.state === 'outdated') {
    return 'The consent text or the server address changed. Connect again '
      + 'to review it.'
  }

  return 'Not given yet. You are asked when you connect.'
})

const pendingTools = computed<ConnectorReviewTool[]>(() => {
  return listing.value?.state === 'ok'
    ? listing.value.tools.filter(tool => tool.change !== 'none')
    : []
})

const reviewedTools = computed<ConnectorReviewTool[]>(() => {
  return listing.value?.state === 'ok'
    ? listing.value.tools.filter(tool => tool.change === 'none')
    : []
})

const unavailableText = computed<string>(() => {
  if (listing.value?.state !== 'unavailable') {
    return ''
  }

  if (listing.value.code === 'CONNECTOR_NOT_READY') {
    return 'Connect this server to see its tools.'
  }

  return `${listing.value.message}.`
})

const canConnectFromTools = computed<boolean>(() => {
  return listing.value?.state === 'unavailable'
    && CONNECT_CODES.has(listing.value.code)
})

function describe(exception: unknown, fallback: string): string {
  const parsedException = parseError(exception)

  return parsedException.message || fallback
}

async function loadTools() {
  isToolsLoading.value = true
  toolsError.value = ''

  try {
    listing.value = await $fetch(
      `/api/v1/connectors/${props.connectorId}/tools/list`,
      { method: 'POST' },
    ) as ConnectorToolsListing
  } catch (exception) {
    toolsError.value = describe(exception, 'Could not load the tools')
  } finally {
    isToolsLoading.value = false
  }
}

async function run(
  task: () => Promise<unknown>,
  fallback: string,
  options: { reloadTools?: boolean } = {},
): Promise<boolean> {
  isBusy.value = true

  try {
    await task()
    await refreshConnectors()

    if (options.reloadTools) {
      await loadTools()
    }

    return true
  } catch (exception) {
    reportConnectorError(exception, fallback)

    return false
  } finally {
    isBusy.value = false
  }
}

async function onToggleEnabled(event: Event) {
  const target = event.target as HTMLInputElement
  const enabled = target.checked

  target.checked = connector.value?.enabled ?? false

  await run(() => {
    return $fetch(`/api/v1/connectors/${props.connectorId}`, {
      method: 'PATCH',
      body: { enabled },
    })
  }, 'Could not change the connector')
}

async function setToolMode(toolMode: ConnectorToolMode) {
  if (connector.value?.toolMode === toolMode) {
    return
  }

  await run(() => {
    return $fetch(`/api/v1/connectors/${props.connectorId}`, {
      method: 'PATCH',
      body: { toolMode },
    })
  }, 'Could not change how the model gets the tools')
}

function applyToolModes(changes: readonly ToolPermissionChange[]) {
  const current = listing.value

  if (current?.state !== 'ok') {
    return
  }

  const modes = new Map(changes.map(change => [change.name, change.mode]))

  listing.value = {
    ...current,
    tools: current.tools.map((tool) => {
      const mode = modes.get(tool.name)

      return mode
        ? {
          ...tool,
          mode,
          enabled: mode !== 'blocked',
          alwaysAllowed: mode === 'allow',
        }
        : tool
    }),
  }
}

async function setToolModes(changes: ToolPermissionChange[]) {
  if (changes.length === 0) {
    return
  }

  isBusy.value = true

  try {
    for (
      let start = 0;
      start < changes.length;
      start += TOOL_SETTINGS_PER_REQUEST
    ) {
      const batch = changes.slice(start, start + TOOL_SETTINGS_PER_REQUEST)

      await $fetch(`/api/v1/connectors/${props.connectorId}/tools/settings`, {
        method: 'POST',
        body: {
          tools: batch.map((change) => {
            return { name: change.name, mode: change.mode }
          }),
        },
      })
      applyToolModes(batch)
    }

    await refreshConnectors()
  } catch (exception) {
    reportConnectorError(exception, 'Could not change the tool permission')
    await loadTools()
  } finally {
    isBusy.value = false
  }
}

async function decide(decision: 'accept' | 'keep-disabled') {
  if (listing.value?.state !== 'ok') {
    return
  }

  const reviewToken = listing.value.reviewToken
  const isSaved = await run(() => {
    return $fetch(`/api/v1/connectors/${props.connectorId}/tools/review`, {
      method: 'POST',
      body: { decision, reviewToken },
    })
  }, 'Could not save the review', { reloadTools: true })

  if (!isSaved) {
    await loadTools()
  }
}

async function withdrawConsent() {
  const current = connector.value

  if (!current) {
    return
  }

  const result = await useConfirm({
    text: `Withdraw your consent for ${current.title}?`,
    subtitle: 'The connector turns off and nothing more is sent to '
      + `${current.host}. To use it again, connect it again.`,
    actions: ['Withdraw'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await run(() => {
    return $fetch(`/api/v1/connectors/${props.connectorId}/consent/withdraw`, {
      method: 'POST',
    })
  }, 'Could not withdraw the consent', { reloadTools: true })
}

async function disconnect() {
  const current = connector.value

  if (!current) {
    return
  }

  const result = await useConfirm({
    text: `Disconnect ${current.title}?`,
    subtitle: 'Besidka signs out of this server and turns the connector off. '
      + 'Your consent and tool settings stay.',
    actions: ['Disconnect'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await run(() => {
    return $fetch(`/api/v1/connectors/${props.connectorId}/disconnect`, {
      method: 'POST',
    })
  }, 'Could not disconnect', { reloadTools: true })
}

async function remove() {
  const current = connector.value

  if (!current) {
    return
  }

  const result = await useConfirm({
    text: `Delete ${current.title}?`,
    subtitle: 'Besidka signs out of the server, withdraws your consent and '
      + 'removes the connector, its key or sign-in and its tool settings. '
      + 'This cannot be undone.',
    alert: true,
    actions: ['Delete'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  const isDeleted = await run(() => {
    return $fetch('/api/v1/connectors/delete/bulk', {
      method: 'POST',
      body: { ids: [props.connectorId] },
    })
  }, 'Could not delete the connector')

  if (isDeleted) {
    useSuccessMessage(`${current.title} deleted`)
    sidePanel.close()
  }
}

watch(
  () => [connector.value?.status, connector.value?.consent.state],
  (next, previous) => {
    if (previous && next.join() !== previous.join()) {
      loadTools()
    }
  },
)

onMounted(loadTools)
</script>
