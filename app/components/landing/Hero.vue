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
          class="group/cta btn btn-primary btn-sm"
          @click="track('cta_click', { target: primaryCta.href })"
        >
          {{ primaryCta.label }}
          <Icon
            v-if="primaryCta.icon"
            :name="primaryCta.icon"
            size="12"
            class="cta-icon"
            aria-hidden="true"
          />
        </NuxtLink>
        <NuxtLink
          v-if="secondaryCta"
          :to="secondaryCta.href"
          class="group/cta btn btn-ghost btn-sm"
          target="_blank"
          rel="noopener noreferrer"
          @click="track('github_click', { target: secondaryCta.href })"
        >
          <Icon
            v-if="secondaryCta.icon"
            :name="secondaryCta.icon"
            size="20"
            class="cta-icon-left"
            aria-hidden="true"
          />
          {{ secondaryCta.label }}
          <span class="sr-only">(opens in new tab)</span>
        </NuxtLink>
      </div>

      <div
        class="flex flex-wrap items-center justify-center gap-2 mt-1"
        aria-label="Project highlights"
      >
        <span
          class="inline-flex items-center gap-1 rounded-full
            border border-base-content/20 bg-base-content/5
            px-2.5 py-0.5 text-[11px] text-base-content/70"
        >
          <Icon
            name="lucide:scale"
            class="size-3"
            aria-hidden="true"
          />
          MIT licensed
        </span>
        <LandingGithubStarsBadge
          v-if="showStarsBadge"
          :show-label="false"
        />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  headline: string
  subheadline?: string
  eyebrow?: string
  primaryCta: { label: string, href: string, icon?: string }
  secondaryCta?: { label: string, href: string, icon?: string }
}>(), {
  subheadline: undefined,
  eyebrow: undefined,
  secondaryCta: undefined,
})

const { track } = useLandingAnalytics()

const { data: starsData, pending: starsPending } = await useGithubStars()

const showStarsBadge = computed<boolean>(() => {
  if (starsPending.value || !starsData.value) {
    return false
  }

  const value = (starsData.value as Record<string, unknown>).stars

  return typeof value === 'number' && value > 0
})
</script>
