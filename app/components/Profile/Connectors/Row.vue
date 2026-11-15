<template>
  <li
    class="list-row items-center gap-3 py-3"
    :class="{ 'bg-base-200': isSelected }"
    data-testid="connector-row"
    :data-connector-id="connector.id"
  >
    <ProfileConnectorsAvatar :title="connector.title" />
    <div class="list-col-grow min-w-0">
      <button
        type="button"
        class="link no-underline block w-full truncate rounded-box text-left font-medium"
        data-testid="connector-row-open"
        @click="emit('open', connector)"
      >
        {{ connector.title }}
      </button>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70">
        <span
          class="min-w-0 truncate"
          data-testid="connector-row-host"
        >
          {{ connector.host }}
        </span>
        <span
          class="badge badge-soft badge-sm"
          :class="STATUS_BADGE_CLASS[status.tone]"
          data-testid="connector-row-status"
        >
          {{ status.label }}
        </span>
        <span
          v-if="toolsLine"
          data-testid="connector-row-tools"
        >
          {{ toolsLine }}
        </span>
      </div>
      <p
        v-if="connector.addedByApp"
        class="mt-1 text-xs text-base-content/70"
        data-testid="connector-row-added-by"
      >
        Added by {{ connector.addedByApp }}, not by you in the app
      </p>
    </div>
    <button
      v-if="needsConnect"
      type="button"
      class="btn btn-sm btn-primary min-h-11 sm:min-h-8"
      :disabled="isBusy"
      data-testid="connector-row-connect"
      @click="emit('connect', connector)"
    >
      Connect
    </button>
    <button
      v-else-if="connector.status === 'drifted'"
      type="button"
      class="btn btn-sm min-h-11 sm:min-h-8"
      :disabled="isBusy"
      data-testid="connector-row-review"
      @click="emit('open', connector)"
    >
      Review
    </button>
    <label
      v-else
      class="flex items-center gap-2 text-sm"
    >
      <span class="sr-only">Use {{ connector.title }} in chats</span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="connector.enabled"
        :disabled="isBusy || !canEnable"
        data-testid="connector-row-toggle"
        @change="onToggle"
      >
    </label>
  </li>
</template>

<script setup lang="ts">
import type { ConnectorPageItem } from '#shared/types/connectors.d'

const STATUS_BADGE_CLASS: Record<ConnectorStatusTone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
}

const props = withDefaults(defineProps<{
  connector: ConnectorPageItem
  isBusy?: boolean
  isSelected?: boolean
}>(), {
  isBusy: false,
  isSelected: false,
})

const emit = defineEmits<{
  open: [connector: ConnectorPageItem]
  connect: [connector: ConnectorPageItem]
  toggle: [connector: ConnectorPageItem, enabled: boolean]
}>()

const status = computed<ConnectorStatusLabel>(() => {
  return getConnectorStatusLabel(props.connector)
})

const needsConnect = computed<boolean>(() => {
  return props.connector.status === 'needs-auth'
    || props.connector.consent.state !== 'current'
})

const canEnable = computed<boolean>(() => {
  return props.connector.enabled || props.connector.status === 'ready'
})

const toolsLine = computed<string>(() => {
  const { tools } = props.connector

  if (!tools.isBaselined || props.connector.status === 'needs-auth') {
    return ''
  }

  return `${tools.enabled} of ${tools.total} tools on`
})

function onToggle(event: Event) {
  const target = event.target as HTMLInputElement

  emit('toggle', props.connector, target.checked)
  target.checked = props.connector.enabled
}
</script>
