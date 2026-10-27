<template>
  <div
    role="alert"
    class="alert alert-soft alert-info !items-start mb-6"
    data-testid="memory-checks-info"
  >
    <Icon
      name="lucide:shield-check"
      size="20"
      class="mt-0.5 shrink-0"
    />
    <div class="grid gap-2 text-sm">
      <p>
        Optional checks that run on your own TypeSafe AI key: memory checks,
        Auto web search, a memory pre-filter, prompt-injection screening,
        search re-ranking, a share check and past-chat retrieval. Each check
        sends TypeSafe AI (US) only the text it needs, and you can switch any
        of them off below once the key is saved. It adds no chat models. Costs
        a fraction of a cent per check on your TypeSafe AI account.
      </p>
      <p>
        <NuxtLink
          :to="guidePath"
          class="link"
          data-testid="memory-checks-guide-link"
        >
          How to get a TypeSafe AI API key
        </NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts" vapor>
const guidePath = '/guides/typesafe-ai-api-key'
</script>
