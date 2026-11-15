<template>
  <HistoryPageShell
    v-if="connectorsFeature.active"
    active-tab="connectors"
  >
    <template #title>
      Connectors
    </template>
    <template #subtitle>
      <p>
        Let models use tools from services you choose. Each server sees only
        what the model sends it.
      </p>
      <p class="mt-2 text-sm text-base-content/70">
        Want an app such as Claude to use Besidka instead? See
        <NuxtLink
          to="/profile/connected-apps"
          class="link"
        >
          Connected apps</NuxtLink>.
      </p>
    </template>

    <p
      class="sr-only"
      aria-live="polite"
      data-testid="connectors-live"
    >
      {{ liveMessage }}
    </p>

    <div class="flex flex-wrap items-center justify-between gap-3 px-1">
      <p
        class="text-sm text-base-content/70"
        data-testid="connectors-count"
      >
        <template v-if="hasLoaded">
          {{ connectors.length }} of {{ CONNECTORS_PER_USER }} connectors
        </template>
      </p>
      <button
        v-if="connectors.length"
        type="button"
        class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
        :disabled="connectors.length >= CONNECTORS_PER_USER"
        data-testid="connectors-add"
        @click="openAdd('presets')"
      >
        <Icon
          name="lucide:plus"
          size="16"
          aria-hidden="true"
        />
        Add connector
      </button>
    </div>

    <div
      v-if="error && !hasLoaded"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="connectors-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <p class="grow">
        Couldn't load your connectors.
      </p>
      <button
        type="button"
        class="btn btn-sm"
        @click="refresh()"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="!hasLoaded"
      class="grid gap-2"
      aria-hidden="true"
      data-testid="connectors-skeleton"
    >
      <div
        v-for="index in SKELETON_ROWS"
        :key="index"
        class="flex items-center gap-3 px-1 py-3"
      >
        <div class="skeleton skeleton--default size-8 shrink-0 rounded-full" />
        <div class="grid flex-1 gap-2">
          <div class="skeleton skeleton--default h-4 w-1/3 rounded-full" />
          <div class="skeleton skeleton--default h-3 w-1/2 rounded-full" />
        </div>
        <div class="skeleton skeleton--default h-6 w-10 shrink-0 rounded-full" />
      </div>
    </div>

    <div
      v-else-if="!connectors.length"
      class="grid justify-items-center gap-3 px-2 py-8 text-center"
      data-testid="connectors-empty"
    >
      <Icon
        name="lucide:cable"
        size="28"
        class="text-base-content/50"
        aria-hidden="true"
      />
      <p class="font-medium">
        No connectors yet
      </p>
      <p class="max-w-md text-sm text-base-content/70">
        Start with GitHub, Notion, Linear or Atlassian, or add any remote MCP
        server by its address.
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
          data-testid="connectors-empty-presets"
          @click="openAdd('presets')"
        >
          Browse presets
        </button>
        <button
          type="button"
          class="btn btn-sm min-h-11 sm:min-h-8"
          data-testid="connectors-empty-url"
          @click="openAdd('url')"
        >
          Add by URL
        </button>
      </div>
    </div>

    <ul
      v-else
      class="list"
      data-testid="connectors-list"
    >
      <ProfileConnectorsRow
        v-for="connector in connectors"
        :key="connector.id"
        :connector="connector"
        :is-busy="busyIds.has(connector.id)"
        :is-selected="selectedId === connector.id"
        @open="openDetail"
        @connect="item => connect.open(item.id)"
        @toggle="toggleConnector"
      />
    </ul>
  </HistoryPageShell>

  <LazyProfileConnectorsAddDialog
    v-if="addTab"
    :added-preset-ids="addedPresetIds"
    :initial-tab="addTab"
    @added="onAdded"
    @close="addTab = null"
  />
  <LazyProfileConnectorsConnectDialog
    v-if="connect.targetId.value"
    :connector-id="connect.targetId.value"
    @connected="onConnected"
    @close="connect.close()"
  />
</template>

<script setup lang="ts">
import { LazyProfileConnectorsDetailPanel } from '#components'
import type { ConnectorPageItem } from '#shared/types/connectors.d'
import { CONNECTORS_PER_USER } from '#shared/utils/connectors-policy'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Connectors',
})

const SKELETON_ROWS = 3
const ADD_TAB_IDS = ['presets', 'url', 'directory'] as const

type AddTabId = typeof ADD_TAB_IDS[number]

const connectorsFeature = useFeature('connectors')

if (!connectorsFeature.value.active) {
  await navigateTo('/chats/history', { replace: true })
}

const route = useRoute()
const router = useRouter()
const sidePanel = useSidePanel()
const connect = useConnectorConnect()
const { connectors, hasLoaded, error, refresh } = useConnectorsPage()

const addTab = shallowRef<AddTabId | null>(null)
const busyIds = shallowRef<Set<string>>(new Set())
const liveMessage = shallowRef<string>('')
const pendingOpenId = shallowRef<string | null>(null)

const addedPresetIds = computed<ReadonlySet<string>>(() => {
  return new Set(connectors.value
    .map(connector => connector.presetId)
    .filter((presetId): presetId is string => !!presetId))
})

const selectedId = computed<string | null>(() => {
  const viewKey = sidePanel.viewKey.value

  return viewKey?.startsWith(CONNECTOR_VIEW_KEY_PREFIX)
    ? viewKey.slice(CONNECTOR_VIEW_KEY_PREFIX.length)
    : null
})

function openAdd(tab: AddTabId) {
  addTab.value = tab
}

function openDetail(connector: Pick<ConnectorPageItem, 'id' | 'title'>) {
  sidePanel.open({
    viewKey: `${CONNECTOR_VIEW_KEY_PREFIX}${connector.id}`,
    title: connector.title,
    mode: 'detail',
    component: LazyProfileConnectorsDetailPanel,
    props: { connectorId: connector.id },
  })
}

function setBusy(connectorId: string, isBusy: boolean) {
  const next = new Set(busyIds.value)

  if (isBusy) {
    next.add(connectorId)
  } else {
    next.delete(connectorId)
  }

  busyIds.value = next
}

async function toggleConnector(connector: ConnectorPageItem, enabled: boolean) {
  setBusy(connector.id, true)

  try {
    await $fetch(`/api/v1/connectors/${connector.id}`, {
      method: 'PATCH',
      body: { enabled },
    })
    await refreshConnectors()
    liveMessage.value = `${connector.title} turned ${enabled ? 'on' : 'off'}`
  } catch (exception) {
    reportConnectorError(exception, 'Could not change the connector')
  } finally {
    setBusy(connector.id, false)
  }
}

function onAdded(connectorId: string) {
  addTab.value = null
  connect.open(connectorId)
}

function onConnected(connectorId: string) {
  connect.close()
  pendingOpenId.value = connectorId
}

async function handleRouteQuery() {
  const query = route.query
  const callback = readConnectorCallback(query)
  const requestedId = typeof query.connector === 'string'
    && /^[A-Za-z0-9]{1,64}$/.test(query.connector)
    ? query.connector
    : null

  const requestedAddTab = ADD_TAB_IDS.find(id => id === query.add) ?? null

  if (!callback && !requestedId && !requestedAddTab) {
    return
  }

  if (requestedAddTab) {
    openAdd(requestedAddTab)
  }

  if (callback?.kind === 'connected') {
    useSuccessMessage(callback.message)
    pendingOpenId.value = callback.connectorId
  } else if (callback?.kind === 'error') {
    useErrorMessage(callback.message)
  }

  if (callback) {
    liveMessage.value = callback.message
  }

  if (requestedId) {
    pendingOpenId.value = requestedId
  }

  await router.replace({
    path: route.path,
    query: Object.fromEntries(Object.entries(query).filter(([key]) => {
      return key !== 'connected'
        && key !== 'error'
        && key !== 'connector'
        && key !== 'add'
    })),
  })
}

watch(
  [hasLoaded, pendingOpenId, connectors],
  ([isLoaded, connectorId]) => {
    if (!isLoaded || !connectorId) {
      return
    }

    const connector = connectors.value.find((item) => {
      return item.id === connectorId
    })

    pendingOpenId.value = null

    if (connector) {
      openDetail(connector)
    }
  },
)

onMounted(handleRouteQuery)

onBeforeUnmount(() => {
  if (sidePanel.viewKey.value?.startsWith(CONNECTOR_VIEW_KEY_PREFIX)) {
    sidePanel.close()
  }

  connect.close()
})
</script>
