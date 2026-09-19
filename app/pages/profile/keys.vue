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
</template>
<script setup lang="ts">
import type { Providers, Provider } from '#shared/types/providers.d'
import { providerMeta } from '#shared/utils/provider-meta'

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

const providers = computed<Providers>(() => {
  return config?.providers as Providers ?? []
})

const enabledProviders = computed<Providers>(() => {
  return providers.value.filter((provider: Provider) => {
    return !!providerMeta[provider.id]
  })
})
</script>
