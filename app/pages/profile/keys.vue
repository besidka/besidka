<template>
  <div class="pb-24">
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
    </ul>
  </div>
</template>
<script setup lang="ts">
definePageMeta({
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
  return providers.value.some((provider) => {
    return provider.id === 'openai'
  })
})

const isGoogleEnabled = computed<boolean>(() => {
  return providers.value.some((provider) => {
    return provider.id === 'google'
  })
})
</script>
