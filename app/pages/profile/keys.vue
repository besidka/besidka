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
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="provider.id"
            :group="providersAccordionGroup"
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
    <p class="mb-6 text-center">
      Search providers give any tool-calling model web search using your own
      search key, instead of the model provider's built-in search.
    </p>
    <ul class="grid gap-4">
      <li
        v-for="providerId in enabledSearchProviders"
        :key="providerId"
      >
        <UiBubble>
          <LazyProfileKeysProviderKeyCard
            :provider-id="providerId"
            :group="searchAccordionGroup"
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
    <p class="mb-6 text-center">
      Gateways proxy to many models using your own gateway account,
      instead of a single provider's key
    </p>
    <ul class="grid gap-4">
      <li
        v-for="gatewayId in enabledGateways"
        :key="gatewayId"
      >
        <UiBubble>
          <LazyProfileKeysCloudflareGateway
            v-if="gatewayId === 'cloudflare'"
            :group="gatewaysAccordionGroup"
          />
          <LazyProfileKeysProviderKeyCard
            v-else
            :provider-id="gatewayId"
            :group="gatewaysAccordionGroup"
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

const activeTab = shallowRef<string>(providersTabId)

const providers = computed<Providers>(() => {
  return config?.providers as Providers ?? []
})

const enabledProviders = computed<Providers>(() => {
  return providers.value.filter((provider: Provider) => {
    return !!providerMeta[provider.id]
  })
})

const tabs: KeyTab[] = [
  { id: providersTabId, label: 'Direct Providers', icon: 'lucide:key-round' },
  { id: searchTabId, label: 'Search Providers', icon: 'lucide:globe' },
  { id: gatewaysTabId, label: 'Gateways', icon: 'lucide:waypoints' },
]
</script>
