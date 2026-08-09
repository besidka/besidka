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
  <ul
    v-if="providers.length"
    class="grid gap-4"
  >
    <li v-if="isAnthropicEnabled">
      <UiBubble>
        <LazyProfileKeysAnthropic />
      </UiBubble>
    </li>
    <li v-if="isGoogleEnabled">
      <UiBubble>
        <LazyProfileKeysGoogle />
      </UiBubble>
    </li>
    <li v-if="isOpenAiEnabled">
      <UiBubble>
        <LazyProfileKeysOpenAi />
      </UiBubble>
    </li>
    <li
      v-for="provider in enabledDirectKeyCardProviders"
      :key="provider.id"
    >
      <UiBubble>
        <LazyProfileKeysProviderKeyCard :provider-id="provider.id" />
      </UiBubble>
    </li>
  </ul>
  <div class="mt-12 mb-8 text-center">
    <h2 class="text-2xl font-bold">Gateways</h2>
    <p class="mt-2">
      Gateways proxy to many models using your own gateway account,
      instead of a single provider's key
    </p>
  </div>
  <ul class="grid gap-4">
    <li
      v-for="gatewayId in enabledGateways"
      :key="gatewayId"
    >
      <UiBubble>
        <LazyProfileKeysCloudflareGateway v-if="gatewayId === 'cloudflare'" />
        <LazyProfileKeysProviderKeyCard
          v-else
          :provider-id="gatewayId"
        />
      </UiBubble>
    </li>
  </ul>
</template>
<script setup lang="ts">
import type { Providers, Provider } from '#shared/types/providers.d'
import { enabledGateways } from '#shared/utils/provider-meta'

const directKeyCardProviderIds = ['xai', 'deepseek', 'moonshotai']

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

const providers = computed<Providers>(() => {
  return config?.providers as Providers ?? []
})

const isOpenAiEnabled = computed<boolean>(() => {
  return providers.value.some((provider: Provider) => {
    return provider.id === 'openai'
  })
})

const isAnthropicEnabled = computed<boolean>(() => {
  return providers.value.some((provider: Provider) => {
    return provider.id === 'anthropic'
  })
})

const isGoogleEnabled = computed<boolean>(() => {
  return providers.value.some((provider: Provider) => {
    return provider.id === 'google'
  })
})

const enabledDirectKeyCardProviders = computed<Providers>(() => {
  return providers.value.filter((provider: Provider) => {
    return directKeyCardProviderIds.includes(provider.id)
  })
})
</script>
