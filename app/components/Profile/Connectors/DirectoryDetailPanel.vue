<template>
  <div
    class="flex flex-col gap-5 py-4"
    data-testid="connector-directory-detail"
  >
    <button
      type="button"
      class="btn btn-ghost btn-sm justify-self-start self-start min-h-11 sm:min-h-8"
      data-testid="connector-directory-detail-back"
      @click="sidePanel.close()"
    >
      <Icon
        name="lucide:arrow-left"
        size="16"
        aria-hidden="true"
      />
      Back to the list
    </button>

    <div
      v-if="entryError && !item"
      class="alert alert-info alert-soft"
      role="status"
      data-testid="connector-directory-detail-missing"
    >
      <span>This connector is no longer in the directory.</span>
    </div>

    <template v-if="item">
      <div class="flex items-start gap-3">
        <ProfileConnectorsAvatar
          :title="item.title"
          :registry-id="isPreset ? null : item.id"
          :preset-id="item.presetId"
          size="lg"
        />
        <div class="grid min-w-0 gap-1">
          <p class="flex flex-wrap items-center gap-2">
            <span
              class="text-lg font-semibold break-words"
              data-testid="connector-directory-detail-title"
            >
              {{ item.title }}
            </span>
            <span
              v-if="item.isCurated"
              class="tooltip tooltip-bottom"
              :data-tip="FEATURED_CONNECTOR_TIP"
            >
              <span
                class="badge badge-soft badge-info badge-sm gap-1"
                tabindex="0"
                :aria-label="`Featured. ${FEATURED_CONNECTOR_TIP}`"
                data-testid="connector-directory-detail-featured"
              >
                <Icon
                  name="lucide:badge-check"
                  size="12"
                  aria-hidden="true"
                />
                Featured
              </span>
            </span>
            <span
              v-else
              class="badge badge-soft badge-sm"
              data-testid="connector-directory-detail-community"
            >
              Community
            </span>
          </p>
          <p
            v-if="item.publisher"
            class="break-all text-sm text-base-content/70"
            data-testid="connector-directory-detail-publisher"
          >
            by {{ item.publisher }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-if="addedConnector"
          type="button"
          class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
          data-testid="connector-directory-detail-primary"
          @click="openAddedConnector"
        >
          {{ needsConnect ? 'Connect' : 'Open' }}
        </button>
        <button
          v-else
          type="button"
          class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
          data-testid="connector-directory-detail-primary"
          @click="addEntry"
        >
          Add and connect
        </button>
      </div>

      <p
        v-if="item.description"
        class="break-words text-sm"
        data-testid="connector-directory-detail-description"
      >
        {{ item.description }}
      </p>

      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt class="text-base-content/70">
          Server
        </dt>
        <dd
          class="break-all font-mono text-xs leading-5"
          data-testid="connector-directory-detail-url"
        >
          {{ item.remoteUrl }}
        </dd>
        <dt class="text-base-content/70">
          Sign-in
        </dt>
        <dd data-testid="connector-directory-detail-auth">
          {{ authLabel }}
        </dd>
        <dt class="text-base-content/70">
          Category
        </dt>
        <dd data-testid="connector-directory-detail-category">
          {{ categoryLabel }}
        </dd>
        <template v-if="item.publisher">
          <dt class="text-base-content/70">
            Publisher
          </dt>
          <dd class="break-all">
            {{ item.publisher }}
          </dd>
        </template>
      </dl>

      <section
        class="grid gap-2"
        aria-labelledby="connector-directory-detail-tools"
        data-testid="connector-directory-detail-tools"
      >
        <h3
          id="connector-directory-detail-tools"
          class="flex items-center gap-2 text-sm font-semibold"
        >
          Tools
          <span
            v-if="probe?.state === 'listed'"
            class="badge badge-soft badge-sm"
          >
            {{ probe.tools.length }}
          </span>
        </h3>
        <div
          v-if="!probe"
          class="grid gap-2"
          aria-hidden="true"
          data-testid="connector-directory-detail-tools-loading"
        >
          <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
          <div class="skeleton skeleton--default h-4 w-1/2 rounded-full" />
        </div>
        <p
          v-else-if="probe.state !== 'listed' || !probe.tools.length"
          class="text-sm text-base-content/70"
          data-testid="connector-directory-detail-tools-later"
        >
          Tools are listed after you connect.
        </p>
        <ul
          v-else
          class="grid gap-2"
          data-testid="connector-directory-detail-tool-list"
        >
          <li
            v-for="tool in probe.tools"
            :key="tool.name"
            class="grid gap-0.5"
          >
            <span class="break-all font-mono text-xs font-medium">
              {{ tool.title || tool.name }}
            </span>
            <span
              v-if="tool.description"
              class="break-words text-xs text-base-content/70"
            >
              {{ tool.description }}
            </span>
          </li>
        </ul>
      </section>

      <p class="text-xs text-base-content/70">
        {{ isPreset
          ? 'A Besidka preset.'
          : 'From the Official MCP Registry. Not reviewed by Besidka.' }}
        {{ CONNECTOR_CATALOG_FOOTER }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { CONNECTOR_CATALOG_FOOTER } from '~~/config/connectors-catalog'
import type {
  ConnectorDirectoryItem,
  ConnectorDirectoryProbe,
} from '#shared/types/connectors.d'

const props = defineProps<{
  entryId: string
  initialItem?: ConnectorDirectoryItem | null
}>()

const sidePanel = useSidePanel()
const actions = useConnectorDirectoryActions()
const connect = useConnectorConnect()
const { connectors } = useConnectorsPage()

const {
  data: entryData,
  error: entryError,
  refresh: refreshEntry,
} = await useLazyFetch(
  '/api/v1/connectors/registry/entry',
  {
    query: { id: props.entryId },
    server: false,
  },
)

const {
  data: probeData,
  execute: loadProbe,
} = await useLazyFetch('/api/v1/connectors/registry/tools', {
  query: { id: props.entryId },
  server: false,
  immediate: false,
})

const item = computed<ConnectorDirectoryItem | null>(() => {
  return (entryData.value?.item ?? props.initialItem ?? null) as
    ConnectorDirectoryItem | null
})

const probe = computed<ConnectorDirectoryProbe | null>(() => {
  return (probeData.value ?? entryData.value?.probe ?? null) as
    ConnectorDirectoryProbe | null
})

const isPreset = computed<boolean>(() => {
  return !!item.value && isDirectoryPresetItem(item.value)
})

const categoryLabel = computed<string>(() => {
  return entryData.value?.categoryLabel ?? '…'
})

const authLabel = computed<string>(() => {
  if (probe.value) {
    return getDirectoryAuthLabel(probe.value.authKind)
  }

  return item.value?.authHint === 'header'
    ? getDirectoryAuthLabel('header')
    : 'Checking…'
})

const addedConnector = computed(() => {
  const connectorId = item.value?.addedConnectorId

  return connectorId
    ? connectors.value.find(connector => connector.id === connectorId) ?? null
    : null
})

const needsConnect = computed<boolean>(() => {
  const connector = addedConnector.value

  return !!connector
    && (connector.status === 'needs-auth' || !isConnectorConnected(connector))
})

function openAddedConnector() {
  const connector = addedConnector.value

  if (!connector) {
    return
  }

  if (needsConnect.value) {
    connect.open(connector.id)

    return
  }

  actions.openAdded(connector)
}

function addEntry() {
  if (item.value) {
    actions.add(item.value)
  }
}

const connectedCount = computed<number>(() => {
  return connectors.value.filter(isConnectorConnected).length
})

watch([() => connectors.value.length, connectedCount], async () => {
  await refreshEntry()
})

watch(entryData, async (value) => {
  if (value && !value.probe) {
    await loadProbe()
  }
})
</script>
