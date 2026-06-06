<template>
  <header
    class="relative w-full pt-16 sm:pt-24 pb-10 sm:pb-14 px-4
      text-center overflow-hidden"
  >
    <div
      class="absolute inset-0 -z-10
        bg-gradient-to-b from-primary/5 via-transparent to-transparent
        pointer-events-none"
      aria-hidden="true"
    />
    <div class="max-w-3xl mx-auto flex flex-col items-center gap-5">
      <p
        v-if="eyebrow"
        class="inline-flex items-center gap-2 rounded-full
          border border-accent/30 bg-accent/10 px-3 py-1
          text-[11px] font-semibold tracking-[0.12em] uppercase
          text-accent"
      >
        {{ eyebrow }}
      </p>
      <h1
        class="text-4xl sm:text-5xl lg:text-6xl font-black
          text-base-content leading-[1.05] tracking-tight"
      >
        {{ headline }}
      </h1>
      <p
        v-if="subheadline"
        class="text-base sm:text-lg text-base-content/70 max-w-xl
          leading-relaxed"
      >
        {{ subheadline }}
      </p>
      <div
        class="flex flex-wrap items-center justify-center gap-3 mt-3"
      >
        <NuxtLink
          :to="primaryCta.href"
          class="btn btn-primary btn-sm"
        >
          {{ primaryCta.label }}
          <Icon name="lucide:arrow-right" class="w-4 h-4" />
        </NuxtLink>
        <NuxtLink
          v-if="secondaryCta"
          :to="secondaryCta.href"
          class="btn btn-ghost btn-sm"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="lucide:github" class="w-4 h-4" />
          {{ secondaryCta.label }}
        </NuxtLink>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  headline: string
  subheadline?: string
  eyebrow?: string
  primaryCta: { label: string, href: string }
  secondaryCta?: { label: string, href: string }
}>(), {
  subheadline: undefined,
  eyebrow: undefined,
  secondaryCta: undefined,
})
</script>
