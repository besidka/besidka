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
      <ProviderIcon
        v-if="tab.providerId"
        :provider-id="tab.providerId"
        :label="tab.label"
        class="!size-4 shrink-0"
      />
      <Icon
        v-else
        name="lucide:key-round"
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
    v-for="gatewayId in enabledGateways"
    v-show="activeTab === gatewayId"
    :id="`key-panel-${gatewayId}`"
    :key="gatewayId"
    role="tabpanel"
    :aria-labelledby="`key-tab-${gatewayId}`"
    :data-testid="`key-panel-${gatewayId}`"
  >
    <p class="mb-6 text-center">
      Gateways proxy to many models using your own gateway account,
      instead of a single provider's key
    </p>
    <UiBubble>
      <LazyProfileKeysCloudflareGateway
        v-if="gatewayId === 'cloudflare'"
        open
      />
      <LazyProfileKeysProviderKeyCard
        v-else
        :provider-id="gatewayId"
        open
      />
    </UiBubble>
  </div>
</template>
<script setup lang="ts">
import type { Providers, Provider } from '#shared/types/providers.d'
import { enabledGateways, providerMeta } from '#shared/utils/provider-meta'

interface KeyTab {
  id: string
  label: string
  providerId?: string
}

const providersTabId = 'providers'
const providersAccordionGroup = 'profile-provider-keys'

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

const tabs = computed<KeyTab[]>(() => {
  return [
    {
      id: providersTabId,
      label: 'Per provider',
    },
    ...enabledGateways.map((gatewayId) => {
      return {
        id: gatewayId,
        label: providerMeta[gatewayId]?.label || gatewayId,
        providerId: gatewayId,
      }
    }),
  ]
})
</script>
