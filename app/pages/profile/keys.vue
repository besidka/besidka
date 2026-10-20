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
        class="scroll-mt-20"
        :class="{
          'js-key-provider-target': provider.id === initialProviderId,
        }"
        :data-testid="
          provider.id === initialProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="provider.id"
            :group="providersAccordionGroup"
            :open="provider.id === initialProviderId"
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
        class="scroll-mt-20"
        :class="{
          'js-key-provider-target': providerId === initialProviderId,
        }"
        :data-testid="
          providerId === initialProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="providerId"
            :group="searchAccordionGroup"
            :open="providerId === initialProviderId"
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
        class="scroll-mt-20"
        :class="{
          'js-key-provider-target': gatewayId === initialProviderId,
        }"
        :data-testid="
          gatewayId === initialProviderId
            ? 'key-provider-target'
            : undefined
        "
      >
        <UiBubble>
          <LazyProfileKeysCloudflareGateway
            v-if="gatewayId === 'cloudflare'"
            :group="gatewaysAccordionGroup"
            :open="gatewayId === initialProviderId"
          />
          <LazyProfileKeysProviderKeyCard
            v-else
            :provider-id="gatewayId"
            :group="gatewaysAccordionGroup"
            :open="gatewayId === initialProviderId"
          />
        </UiBubble>
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import type { Providers, Provider } from '#shared/types/providers.d'
import {
  enabledGateways,
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
const providersAccordionGroup = 'profile-provider-keys'
const searchAccordionGroup = 'profile-search-provider-keys'
const gatewaysAccordionGroup = 'profile-gateway-keys'

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

const tabIds = [providersTabId, searchTabId, gatewaysTabId]

const providers = computed<Providers>(() => {
  return config?.providers as Providers ?? []
})

const enabledProviders = computed<Providers>(() => {
  return providers.value.filter((provider: Provider) => {
    return !!providerMeta[provider.id]
  })
})

function resolveInitialProviderTarget(): ProviderTarget | null {
  const providerParam = route.query.provider

  if (typeof providerParam !== 'string') {
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

  return null
}

const initialProviderTarget = resolveInitialProviderTarget()
const initialProviderId = shallowRef<string | null>(
  initialProviderTarget?.id ?? null,
)

function resolveInitialTab(): string {
  if (initialProviderTarget) {
    return initialProviderTarget.tab
  }

  const tabParam = route.query.tab

  if (typeof tabParam === 'string' && tabIds.includes(tabParam)) {
    return tabParam
  }

  return providersTabId
}

const activeTab = shallowRef<string>(resolveInitialTab())

onMounted(async () => {
  if (!initialProviderId.value) {
    return
  }

  await nextTick()

  document.querySelector('.js-key-provider-target')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
})

const tabs: KeyTab[] = [
  { id: providersTabId, label: 'Direct Providers', icon: 'lucide:key-round' },
  { id: searchTabId, label: 'Search Providers', icon: 'lucide:globe' },
  { id: gatewaysTabId, label: 'Gateways', icon: 'lucide:waypoints' },
]
</script>
