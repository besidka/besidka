<template>
  <LandingMessageBubble
    role="assistant"
    :sr-label="`Use case: ${persona}`"
  >
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <Icon
          :name="icon"
          class="size-5 text-accent shrink-0"
          aria-hidden="true"
        />
        <p class="font-semibold text-sm text-base-content">{{ persona }}</p>
      </div>
      <p class="text-sm text-base-content/80 leading-relaxed">{{ scenario }}</p>
      <p
        class="text-xs text-accent font-medium border-t
          border-base-content/20 pt-3 mt-1"
      >
        {{ payoff }}
      </p>
      <div
        v-if="link"
        class="text-xs text-base-content/60 pt-1"
      >
        <a
          :href="link"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-accent transition-colors"
        >
          Learn more<span class="sr-only"> (opens in new tab)</span>
        </a>
      </div>
    </div>
  </LandingMessageBubble>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  persona: string
  scenario: string
  payoff: string
  link?: string
}>(), {
  link: undefined,
})
</script>
