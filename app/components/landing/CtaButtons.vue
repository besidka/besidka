<template>
  <div
    class="flex flex-wrap gap-2 items-center"
    :class="{
      'justify-start': align === 'left',
      'justify-center': align === 'center',
      'justify-end': align === 'right',
    }"
  >
    <NuxtLink
      :to="primary.href"
      class="group/cta btn btn-primary btn-sm"
      :target="isExternal(primary.href) ? '_blank' : undefined"
      :rel="isExternal(primary.href) ? 'noopener noreferrer' : undefined"
      @click="track('cta_click', { target: primary.href })"
    >
      {{ primary.label }}
      <Icon
        v-if="primary.icon"
        :name="primary.icon"
        size="12"
        class="cta-icon"
        aria-hidden="true"
      />
      <span v-if="isExternal(primary.href)" class="sr-only">
        (opens in new tab)
      </span>
    </NuxtLink>
    <NuxtLink
      v-if="secondary"
      :to="secondary.href"
      class="group/cta btn btn-ghost btn-sm"
      :target="isExternal(secondary.href) ? '_blank' : undefined"
      :rel="isExternal(secondary.href) ? 'noopener noreferrer' : undefined"
      @click="track('cta_click', { target: secondary.href })"
    >
      <Icon
        v-if="secondary.icon"
        :name="secondary.icon"
        size="20"
        class="cta-icon-left"
        aria-hidden="true"
      />
      {{ secondary.label }}
      <span v-if="isExternal(secondary.href)" class="sr-only">
        (opens in new tab)
      </span>
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  primary: { label: string, href: string, icon?: string }
  secondary?: { label: string, href: string, icon?: string }
  align?: 'left' | 'center' | 'right'
}>(), {
  secondary: undefined,
  align: 'center',
})

const { track } = useLandingAnalytics()

function isExternal(href: string) {
  return /^https?:\/\//.test(href)
}
</script>
