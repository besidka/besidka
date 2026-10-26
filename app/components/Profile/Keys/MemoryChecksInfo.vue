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
        Used only for memory checks, never for chat. When you save memory,
        Besidka sends the candidate entry text to TypeSafe AI (US) to
        double-check it for sensitive data and to confirm it really comes
        from your conversation. Costs a fraction of a cent per check on your
        TypeSafe AI account.
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
