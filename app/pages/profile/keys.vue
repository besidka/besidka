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
    <li v-if="isOpenAiEnabled">
      <UiBubble>
        <LazyProfileKeysOpenAi />
      </UiBubble>
    </li>
  </ul>
</template>
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

useSeoMeta({
  title: 'API Keys',
})

const config = useRuntimeConfig().public

const providers = computed<string[]>(() => {
  return config?.providers as string[] ?? []
})

const isOpenAiEnabled = computed<boolean>(() => {
  return providers.value.includes('openai')
})
</script>
