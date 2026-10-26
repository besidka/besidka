<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">API Keys</h1>
    <h2 class="mt-2">Bringing your API keys to use LLMs from different providers</h2>
  </div>
  <div
    role="alert"
    class="alert alert-soft alert-info mb-8 !shadow-lg"
  >
    <Icon name="lucide:info" size="16" />
    All keys are stored securely and encrypted in database
  </div>
  <nav
    aria-label="Key sections"
    class="tabs tabs-box tabs-sm mb-6"
  >
    <button
      v-for="tab in tabs"
      :id="`key-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      class="tab grow gap-2"
      :class="{ 'tab-active': activeTab === tab.id }"
      :aria-controls="`key-panel-${tab.id}`"
      :aria-current="activeTab === tab.id ? 'true' : undefined"
      :aria-label="tab.label"
      :title="tab.label"
      :data-testid="`key-tab-${tab.id}`"
      @click="activeTab = tab.id"
    >
      <Icon
        :name="tab.icon"
        size="16"
        class="shrink-0"
      />
      <span v-if="activeTab === tab.id">{{ tab.label }}</span>
    </button>
  </nav>
  <div
    v-show="activeTab === providersTabId"
    :id="`key-panel-${providersTabId}`"
    role="tabpanel"
    :aria-labelledby="`key-tab-${providersTabId}`"
    :data-testid="`key-panel-${providersTabId}`"
  >
    <ul class="grid gap-4">
      <li
        v-for="provider in enabledProviders"
        :key="provider.id"
        :ref="(element) => registerItem(provider.id, element)"
        :data-testid="
          provider.id === requestedProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="provider.id"
            :group="providersAccordionGroup"
            :open="expandedProviderId === provider.id"
            :guide="guidesByProvider[provider.id] ?? null"
            @expanded-change="onExpandedChange(provider.id, $event)"
          />
        </UiBubble>
      </li>
    </ul>
  </div>
  <div
    v-show="activeTab === searchTabId"
    :id="`key-panel-${searchTabId}`"
    role="tabpanel"
    :aria-labelledby="`key-tab-${searchTabId}`"
    :data-testid="`key-panel-${searchTabId}`"
  >
    <ProfileKeysSearchProvidersInfo />
    <ul class="grid gap-4">
      <li
        v-for="providerId in enabledSearchProviders"
        :key="providerId"
        :ref="(element) => registerItem(providerId, element)"
        :data-testid="
          providerId === requestedProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="providerId"
            :group="searchAccordionGroup"
            :open="expandedProviderId === providerId"
            :guide="guidesByProvider[providerId] ?? null"
            @expanded-change="onExpandedChange(providerId, $event)"
          />
        </UiBubble>
      </li>
    </ul>
  </div>
  <div
    v-show="activeTab === gatewaysTabId"
    :id="`key-panel-${gatewaysTabId}`"
    role="tabpanel"
    :aria-labelledby="`key-tab-${gatewaysTabId}`"
    :data-testid="`key-panel-${gatewaysTabId}`"
  >
    <ProfileKeysGatewaysInfo />
    <ul class="grid gap-4">
      <li
        v-for="gatewayId in enabledGateways"
        :key="gatewayId"
        :ref="(element) => registerItem(gatewayId, element)"
        :data-testid="
          gatewayId === requestedProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysCloudflareGateway
            v-if="gatewayId === 'cloudflare'"
            :group="gatewaysAccordionGroup"
            :open="expandedProviderId === gatewayId"
            :guide="guidesByProvider[gatewayId] ?? null"
            @expanded-change="onExpandedChange(gatewayId, $event)"
          />
          <LazyProfileKeysProviderKeyCard
            v-else
            :provider-id="gatewayId"
            :group="gatewaysAccordionGroup"
            :open="expandedProviderId === gatewayId"
            :guide="guidesByProvider[gatewayId] ?? null"
            @expanded-change="onExpandedChange(gatewayId, $event)"
          />
        </UiBubble>
      </li>
    </ul>
  </div>
  <div
    v-show="activeTab === memoryChecksTabId"
    :id="`key-panel-${memoryChecksTabId}`"
    role="tabpanel"
    :aria-labelledby="`key-tab-${memoryChecksTabId}`"
    :data-testid="`key-panel-${memoryChecksTabId}`"
  >
    <ProfileKeysMemoryChecksInfo />
    <ul class="grid gap-4">
      <li
        v-for="providerId in enabledMemoryCheckProviders"
        :key="providerId"
        :ref="(element) => registerItem(providerId, element)"
        :data-testid="
          providerId === requestedProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="providerId"
            :group="memoryChecksAccordionGroup"
            :open="expandedProviderId === providerId"
            :guide="guidesByProvider[providerId] ?? null"
            @expanded-change="onExpandedChange(providerId, $event)"
          />
        </UiBubble>
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import type { KeyGuidesCollectionItem } from '@nuxt/content'
import type { Providers, Provider } from '#shared/types/providers.d'
import {
  enabledGateways,
  enabledMemoryCheckProviders,
  enabledSearchProviders,
  providerMeta,
} from '#shared/utils/provider-meta'

interface ProviderTarget {
  id: string
  tab: string
}

interface KeyTab {
  id: string
  label: string
  icon: string
}

const providersTabId = 'providers'
const searchTabId = 'search'
const gatewaysTabId = 'gateways'
const memoryChecksTabId = 'memory-checks'
const defaultProviderId = 'google'
const providersAccordionGroup = 'profile-provider-keys'
const searchAccordionGroup = 'profile-search-provider-keys'
const gatewaysAccordionGroup = 'profile-gateway-keys'
const memoryChecksAccordionGroup = 'profile-memory-check-keys'
const ALIGN_SETTLE_MS = 2000
const ALIGN_TOLERANCE_PX = 2
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown']

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'API Keys',
  robots: 'noindex, nofollow',
})

const config = useRuntimeConfig().public
const route = useRoute()

resetKeyGuideTracking()

const tabIds = [
  providersTabId,
  searchTabId,
  gatewaysTabId,
  memoryChecksTabId,
]

const providers = computed<Providers>(() => {
  return config?.providers as Providers ?? []
})

const enabledProviders = computed<Providers>(() => {
  return providers.value.filter((provider: Provider) => {
    return !!providerMeta[provider.id]
  })
})

const { data: keyGuides } = await useAsyncData('key-guides', () => {
  return queryCollection('keyGuides').all()
})

const guidesByProvider = computed<Record<string, KeyGuidesCollectionItem>>(
  () => {
    return Object.fromEntries(
      (keyGuides.value ?? []).map((guide) => {
        return [guide.provider, guide]
      }),
    )
  },
)

function resolveRequestedProviderTarget(): ProviderTarget | null {
  const providerParam = route.query.provider

  if (
    typeof providerParam !== 'string'
    || !Object.hasOwn(providerMeta, providerParam)
  ) {
    return null
  }

  const isEnabledProvider = enabledProviders.value.some((provider) => {
    return provider.id === providerParam
  })

  if (isEnabledProvider) {
    return { id: providerParam, tab: providersTabId }
  }

  if ((enabledGateways as string[]).includes(providerParam)) {
    return { id: providerParam, tab: gatewaysTabId }
  }

  if (enabledSearchProviders.includes(providerParam)) {
    return { id: providerParam, tab: searchTabId }
  }

  if (enabledMemoryCheckProviders.includes(providerParam)) {
    return { id: providerParam, tab: memoryChecksTabId }
  }

  return null
}

function resolveRequestedTab(): string | null {
  const tabParam = route.query.tab

  if (typeof tabParam === 'string' && tabIds.includes(tabParam)) {
    return tabParam
  }

  return null
}

const requestedProviderTarget = resolveRequestedProviderTarget()
const requestedProviderId = requestedProviderTarget?.id ?? null
const requestedTab = resolveRequestedTab()
const hasExplicitTarget = !!requestedProviderTarget || !!requestedTab

const activeTab = shallowRef<string>(
  requestedProviderTarget?.tab ?? requestedTab ?? providersTabId,
)
const expandedProviderId = shallowRef<string | null>(requestedProviderId)

const itemElements = new Map<string, HTMLElement>()

const { hasAnyKey, keyStatusForProvider } = useUserKeys()

const hasLoadedKeys = computed<boolean>(() => {
  return keyStatusForProvider(defaultProviderId) !== 'unknown'
})

const isHydrating = shallowRef<boolean>(!!useNuxtApp().isHydrating)

onMounted(() => {
  isHydrating.value = false
})

let hasDecidedDefaultProvider = false
let pendingScrollProviderId: string | null = requestedProviderId
let stopAligning: (() => void) | null = null

function registerItem(providerId: string, element: unknown) {
  if (element instanceof HTMLElement) {
    itemElements.set(providerId, element)

    return
  }

  itemElements.delete(providerId)
}

async function onExpandedChange(providerId: string, isExpanded: boolean) {
  if (!isExpanded || pendingScrollProviderId !== providerId) {
    return
  }

  pendingScrollProviderId = null

  await nextTick()
  alignToProvider(providerId)
}

function alignToProvider(providerId: string) {
  const element = itemElements.get(providerId)
  const list = element?.parentElement

  if (!element || !list) {
    return
  }

  stopAligning?.()

  const scrollToElement = () => {
    element.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const realignIfDrifted = () => {
    if (!element.isConnected) {
      return
    }

    const scroller = element.closest('.js-page-content')
    const drift = element.getBoundingClientRect().top
      - (scroller?.getBoundingClientRect().top ?? 0)

    if (Math.abs(drift) > ALIGN_TOLERANCE_PX) {
      scrollToElement()
    }
  }
  const resizeObserver = new ResizeObserver(realignIfDrifted)
  const settleTimer = setTimeout(stopCurrentAlignment, ALIGN_SETTLE_MS)

  function stopCurrentAlignment() {
    clearTimeout(settleTimer)
    resizeObserver.disconnect()
    window.removeEventListener('scroll', realignIfDrifted, true)

    for (const inputEvent of USER_INPUT_EVENTS) {
      window.removeEventListener(inputEvent, stopCurrentAlignment)
    }

    stopAligning = null
  }

  for (const inputEvent of USER_INPUT_EVENTS) {
    window.addEventListener(inputEvent, stopCurrentAlignment, {
      passive: true,
    })
  }

  stopAligning = stopCurrentAlignment
  scrollToElement()
  resizeObserver.observe(list)
  window.addEventListener('scroll', realignIfDrifted, {
    capture: true,
    passive: true,
  })
}

onBeforeUnmount(() => {
  stopAligning?.()
})

watch([hasLoadedKeys, hasAnyKey, isHydrating], ([isLoaded, anyKey]) => {
  if (!isLoaded || isHydrating.value || hasDecidedDefaultProvider) {
    return
  }

  hasDecidedDefaultProvider = true

  if (anyKey || hasExplicitTarget) {
    return
  }

  activeTab.value = providersTabId
  expandedProviderId.value = defaultProviderId
}, { immediate: true })

const tabs: KeyTab[] = [
  { id: providersTabId, label: 'Direct Providers', icon: 'lucide:key-round' },
  { id: searchTabId, label: 'Search Providers', icon: 'lucide:globe' },
  { id: gatewaysTabId, label: 'Gateways', icon: 'lucide:waypoints' },
  {
    id: memoryChecksTabId,
    label: 'Memory checks',
    icon: 'lucide:shield-check',
  },
]
</script>
