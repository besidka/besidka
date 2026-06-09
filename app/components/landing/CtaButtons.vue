<template>
  <div
    class="flex flex-wrap gap-2 items-center"
    :class="{
      'justify-start': align === 'left',
      'justify-center': align === 'center',
      'justify-end': align === 'right',
    }"
  >
    <a
      v-if="isAnchor(primary.href)"
      :href="primary.href"
      class="group/cta btn btn-primary btn-sm"
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
    </a>
    <a
      v-else-if="isExternal(primary.href)"
      :href="primary.href"
      class="group/cta btn btn-primary btn-sm"
      target="_blank"
      rel="noopener noreferrer"
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
      <span class="sr-only">(opens in new tab)</span>
    </a>
    <NuxtLink
      v-else
      :to="primary.href"
      class="group/cta btn btn-primary btn-sm"
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
    </NuxtLink>

    <template v-if="secondary">
      <a
        v-if="isAnchor(secondary.href)"
        :href="secondary.href"
        class="group/cta btn btn-ghost btn-sm"
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
      </a>
      <a
        v-else-if="isExternal(secondary.href)"
        :href="secondary.href"
        class="group/cta btn btn-ghost btn-sm"
        target="_blank"
        rel="noopener noreferrer"
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
        <span class="sr-only">(opens in new tab)</span>
      </a>
      <NuxtLink
        v-else
        :to="secondary.href"
        class="group/cta btn btn-ghost btn-sm"
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
      </NuxtLink>
    </template>
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

function isAnchor(href: string) {
  return href.startsWith('#')
}

function isExternal(href: string) {
  return /^https?:\/\//.test(href)
}
</script>
