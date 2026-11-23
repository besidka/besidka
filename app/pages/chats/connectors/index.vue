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

    <template
      v-if="registryFeature.active"
      #toolbar
    >
      <HistoryBoxTabs
        :options="VIEW_OPTIONS"
        :model-value="view"
        label="Connectors"
        test-id-prefix="connectors-view"
        @select="selectView"
      />
    </template>

    <p
      class="sr-only"
      aria-live="polite"
      data-testid="connectors-live"
    >
      {{ liveMessage }}
    </p>

    <LazyProfileConnectorsDirectory v-if="view === 'discover'" />

    <template v-else>
    <div class="flex flex-wrap items-center justify-between gap-3 px-1">
      <p
        class="text-sm text-base-content/70"
        data-testid="connectors-count"
      >
        <template v-if="hasLoaded">
          {{ connectors.length }} of {{ CONNECTORS_PER_USER }} connectors
        </template>
      </p>
      <div
        v-if="connectors.length"
        class="flex flex-wrap items-center gap-2"
      >
        <button
          v-if="registryFeature.active"
          type="button"
          class="btn btn-sm min-h-11 sm:min-h-8"
          :disabled="connectors.length >= CONNECTORS_PER_USER"
          data-testid="connectors-add-url"
          @click="openAdd('url')"
        >
          Add by URL
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
          :disabled="connectors.length >= CONNECTORS_PER_USER"
          data-testid="connectors-add"
          @click="startAdding"
        >
          <Icon
            name="lucide:plus"
            size="16"
            aria-hidden="true"
          />
          Add connector
        </button>
      </div>
    </div>

    <ul
      v-if="
        isBesidkaRowVisible
          || googleEntries.length
          || (hasLoaded && connectors.length)
      "
      class="list"
      data-testid="connectors-list"
    >
      <ProfileConnectorsBesidkaRow
        v-if="isBesidkaRowVisible"
        :is-active="isBesidkaActive"
        :is-busy="isBesidkaBusy"
        :is-selected="isBesidkaSelected"
        @open="openBesidkaPermissions"
        @toggle="toggleBesidka"
      />
      <li
        v-if="googleEntries.length"
        data-testid="connectors-google-group"
      >
        <h3
          id="connectors-google-heading"
          class="sr-only"
        >
          Google
        </h3>
        <ul
          aria-labelledby="connectors-google-heading"
          data-testid="connectors-google-list"
        >
          <ProfileConnectorsGoogleRow
            v-for="entry in googleEntries"
            :key="entry.id"
            :entry="entry"
            :is-busy="isGoogleBusy"
            :is-selected="selectedGoogleId === entry.id"
            @open="googlePanel.open"
            @action="runGoogleAction"
          />
        </ul>
      </li>
      <template v-if="hasLoaded">
        <ProfileConnectorsRow
          v-for="connector in connectors"
          :key="connector.id"
          :connector="connector"
          :is-busy="busyIds.has(connector.id)"
          :is-selected="selectedId === connector.id"
          @open="openDetail"
          @connect="item => connect.open(item.id)"
          @remove="removeConnector"
          @toggle="toggleConnector"
        />
      </template>
    </ul>

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
          @click="startAdding"
        >
          {{ registryFeature.active ? 'Browse connectors' : 'Browse presets' }}
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

    </template>
  </HistoryPageShell>

  <LazyProfileConnectorsAddDialog
    v-if="addTab"
    :added-preset-ids="addedPresetIds"
    :initial-tab="addTab"
    @picked="onPicked"
    @close="addTab = null"
  />
  <LazyProfileConnectorsConnectDialog
    v-if="connect.targetId.value || connect.draft.value"
    :connector-id="connect.targetId.value ?? undefined"
    :draft="connect.draft.value ?? undefined"
    @connected="onConnected"
    @close="connect.close()"
  />
</template>

<script setup lang="ts">
import type { ConnectorPageItem } from '#shared/types/connectors.d'
import { CONNECTORS_PER_USER } from '#shared/utils/connectors-policy'
import { GOOGLE_BYO_RESULT_QUERY_KEY } from '#shared/utils/google-byo'
import {
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
  isGoogleConnectResult,
} from '#shared/utils/google-connections'
import {
  GOOGLE_ENTRY_PANEL_QUERY_KEY,
  isGoogleEntryId,
} from '#shared/utils/google-connectors'
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import type { GoogleConnectResult } from '#shared/utils/google-connections'
import type { GoogleEntry } from '~/utils/google-entries'
import BesidkaToolPermissions from '~/components/Profile/BesidkaTools/Permissions.vue'
import {
  BESIDKA_TOOL_PERMISSIONS_PANEL_KEY,
  BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE,
} from '~/utils/besidka-tool-permissions'

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
const VIEW_OPTIONS = [
  { value: 'yours', label: 'Yours' },
  { value: 'discover', label: 'Discover' },
]

const HANDLED_QUERY_KEYS = new Set([
  'connected',
  'error',
  'connector',
  'add',
  'tab',
  'panel',
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
  GOOGLE_BYO_RESULT_QUERY_KEY,
])

const GOOGLE_RESULT_FALLBACK_PANELS: Readonly<
  Record<GoogleClientMode, GoogleEntryId>
> = {
  besidka: 'google-drive',
  byo: 'google-gmail',
}

const BESIDKA_TOOLS_FEATURE_KEY = 'besidka-tools'
const BESIDKA_PERMISSIONS_TITLE = 'Tool permissions'

type AddTabId = typeof ADD_TAB_IDS[number]
type ConnectorsView = 'yours' | 'discover'

const connectorsFeature = useFeature('connectors')
const registryFeature = useFeature('connectors.registry')
const besidkaToolsFeature = useFeature(BESIDKA_TOOLS_FEATURE_KEY)

if (!connectorsFeature.value.active) {
  await navigateTo('/chats/history', { replace: true })
}

const route = useRoute()
const router = useRouter()
const sidePanel = useSidePanel()
const connect = useConnectorConnect()
const { setFeatureOptIn } = useFeatureOptIn()
const detailPanel = useConnectorDetailPanel()
const { connectors, hasLoaded, error, refresh } = useConnectorsPage()
const {
  entries: googleEntries,
  refresh: refreshGoogle,
} = useGoogleEntries()
const googlePanel = useGoogleEntryPanel()
const googleActions = useGoogleEntryActions()
const { isBusy: isGoogleBusy } = googleActions

const addTab = shallowRef<AddTabId | null>(null)
const view = shallowRef<ConnectorsView>('yours')
const busyIds = shallowRef<Set<string>>(new Set())
const liveMessage = shallowRef<string>('')
const pendingOpenId = shallowRef<string | null>(null)
const isBesidkaBusy = shallowRef<boolean>(false)

const addedPresetIds = computed<ReadonlySet<string>>(() => {
  return new Set(connectors.value
    .filter(isConnectorConnected)
    .map(connector => connector.presetId)
    .filter((presetId): presetId is string => !!presetId))
})

const selectedId = computed<string | null>(() => {
  const viewKey = sidePanel.viewKey.value

  return viewKey?.startsWith(CONNECTOR_VIEW_KEY_PREFIX)
    ? viewKey.slice(CONNECTOR_VIEW_KEY_PREFIX.length)
    : null
})

const selectedGoogleId = computed<string | null>(() => {
  const viewKey = sidePanel.viewKey.value

  return viewKey?.startsWith(GOOGLE_ENTRY_VIEW_KEY_PREFIX)
    ? viewKey.slice(GOOGLE_ENTRY_VIEW_KEY_PREFIX.length)
    : null
})

const isBesidkaRowVisible = computed<boolean>(() => {
  return besidkaToolsFeature.value.enabled
})

const isBesidkaActive = computed<boolean>(() => {
  return besidkaToolsFeature.value.active
})

const isBesidkaSelected = computed<boolean>(() => {
  return sidePanel.viewKey.value === BESIDKA_TOOL_PERMISSIONS_PANEL_KEY
})

function openAdd(tab: AddTabId) {
  addTab.value = tab
}

async function selectView(next: string) {
  view.value = next === 'discover' ? 'discover' : 'yours'
  await router.replace({
    path: route.path,
    query: {
      ...route.query,
      tab: view.value === 'discover' ? 'discover' : undefined,
    },
  })
}

async function startAdding() {
  if (registryFeature.value.active) {
    await selectView('discover')

    return
  }

  openAdd('presets')
}

function openDetail(connector: Pick<ConnectorPageItem, 'id' | 'title'>) {
  detailPanel.open(connector)
}

function openBesidkaPermissions() {
  sidePanel.open({
    viewKey: BESIDKA_TOOL_PERMISSIONS_PANEL_KEY,
    title: BESIDKA_PERMISSIONS_TITLE,
    component: BesidkaToolPermissions,
  })
}

async function runGoogleAction(entry: GoogleEntry) {
  await googleActions.run(entry)

  if (googleActions.announcement.value) {
    liveMessage.value = googleActions.announcement.value
  }
}

async function toggleBesidka(enabled: boolean) {
  isBesidkaBusy.value = true

  try {
    await setFeatureOptIn(BESIDKA_TOOLS_FEATURE_KEY, enabled)

    if (!enabled && isBesidkaSelected.value) {
      sidePanel.close()
    }

    if (isBesidkaActive.value !== enabled) {
      useErrorMessage(
        'Besidka tools may not have updated',
        'Your choice was saved, but this page could not refresh. '
        + 'Reload the page to see the current state.',
      )

      return
    }

    liveMessage.value = `Besidka tools turned ${enabled ? 'on' : 'off'}`
  } catch (exception) {
    reportConnectorError(exception, 'Could not change Besidka tools')
  } finally {
    isBesidkaBusy.value = false
  }
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

function onPicked(draft: ConnectorDraft) {
  addTab.value = null

  const unfinished = draft.presetId
    ? connectors.value.find((connector) => {
      return connector.presetId === draft.presetId
        && !isConnectorConnected(connector)
    })
    : undefined

  if (unfinished) {
    connect.open(unfinished.id)

    return
  }

  connect.openDraft(draft)
}

async function removeConnector(connector: ConnectorPageItem) {
  setBusy(connector.id, true)

  try {
    await $fetch('/api/v1/connectors/delete/bulk', {
      method: 'POST',
      body: { ids: [connector.id] },
    })
    await refreshConnectors()
    liveMessage.value = `${connector.title} removed`
    useSuccessMessage(`${connector.title} removed`)
  } catch (exception) {
    reportConnectorError(exception, 'Could not remove the connector')
  } finally {
    setBusy(connector.id, false)
  }
}

function onConnected(connectorId: string) {
  connect.close()
  pendingOpenId.value = connectorId
}

function readGoogleResults(
  query: Record<string, unknown>,
): Array<{ clientMode: GoogleClientMode, result: GoogleConnectResult }> {
  const found: Array<{
    clientMode: GoogleClientMode
    result: GoogleConnectResult
  }> = []
  const besidkaResult = query[GOOGLE_CONNECT_RESULT_QUERY_KEY]
  const byoResult = query[GOOGLE_BYO_RESULT_QUERY_KEY]

  if (isGoogleConnectResult(besidkaResult)) {
    found.push({ clientMode: 'besidka', result: besidkaResult })
  }

  if (isGoogleConnectResult(byoResult)) {
    found.push({ clientMode: 'byo', result: byoResult })
  }

  return found
}

async function handleGoogleRouteQuery(
  results: ReturnType<typeof readGoogleResults>,
  requestedEntryId: GoogleEntryId | null,
) {
  for (const { clientMode, result } of results) {
    reportGoogleConnectResult(clientMode, result)
    liveMessage.value = getGoogleConnectResultMessage(clientMode, result).title

    if (result === 'connected' || result === 'partial') {
      await refreshGoogle()
    }
  }

  const firstResult = results[0]
  const fallbackEntryId = firstResult
    ? GOOGLE_RESULT_FALLBACK_PANELS[firstResult.clientMode]
    : null
  const entryId = requestedEntryId ?? fallbackEntryId

  if (entryId) {
    googlePanel.open(entryId)
  }
}

async function handleRouteQuery() {
  const query = route.query
  const callback = readConnectorCallback(query)
  const requestedId = typeof query.connector === 'string'
    && /^[A-Za-z0-9]{1,64}$/.test(query.connector)
    ? query.connector
    : null

  const requestedAddTab = ADD_TAB_IDS.find(id => id === query.add) ?? null
  const requestedBesidkaPanel
    = query.panel === BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE

  const requestedGoogleEntryId = isGoogleEntryId(
    query[GOOGLE_ENTRY_PANEL_QUERY_KEY],
  )
    ? query[GOOGLE_ENTRY_PANEL_QUERY_KEY] as GoogleEntryId
    : null
  const googleResults = readGoogleResults(query)

  if (query.tab === 'discover' && registryFeature.value.active) {
    view.value = 'discover'
  }

  if (
    !callback
    && !requestedId
    && !requestedAddTab
    && !requestedBesidkaPanel
    && !requestedGoogleEntryId
    && !googleResults.length
  ) {
    return
  }

  if (requestedBesidkaPanel && isBesidkaActive.value) {
    openBesidkaPermissions()
  }

  await handleGoogleRouteQuery(googleResults, requestedGoogleEntryId)

  if (requestedAddTab === 'url' || !registryFeature.value.active) {
    if (requestedAddTab) {
      openAdd(requestedAddTab)
    }
  } else if (requestedAddTab) {
    view.value = 'discover'
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
    query: {
      ...Object.fromEntries(Object.entries(query).filter(([key]) => {
        return !HANDLED_QUERY_KEYS.has(key)
      })),
      ...(view.value === 'discover' ? { tab: 'discover' } : {}),
    },
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

watch(() => route.query.connector, async (connectorId) => {
  if (typeof connectorId === 'string') {
    await handleRouteQuery()
  }
})

watch(() => route.query.panel, async (panel) => {
  if (
    panel === BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE
    || isGoogleEntryId(panel)
  ) {
    await handleRouteQuery()
  }
})

onBeforeUnmount(() => {
  const viewKey = sidePanel.viewKey.value ?? ''

  if (
    viewKey.startsWith(CONNECTOR_VIEW_KEY_PREFIX)
    || viewKey.startsWith(CONNECTOR_DIRECTORY_VIEW_KEY_PREFIX)
    || viewKey.startsWith(GOOGLE_ENTRY_VIEW_KEY_PREFIX)
    || viewKey === BESIDKA_TOOL_PERMISSIONS_PANEL_KEY
  ) {
    sidePanel.close()
  }

  connect.close()
})
</script>
