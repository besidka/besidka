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
      class="btn btn-primary btn-sm"
      :target="isExternal(primary.href) ? '_blank' : undefined"
      :rel="isExternal(primary.href) ? 'noopener noreferrer' : undefined"
    >
      {{ primary.label }}
      <Icon name="lucide:arrow-right" class="w-4 h-4" />
    </NuxtLink>
    <NuxtLink
      v-if="secondary"
      :to="secondary.href"
      class="btn btn-ghost btn-sm"
      :target="isExternal(secondary.href) ? '_blank' : undefined"
      :rel="isExternal(secondary.href) ? 'noopener noreferrer' : undefined"
    >
      {{ secondary.label }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  primary: { label: string, href: string }
  secondary?: { label: string, href: string }
  align?: 'left' | 'center' | 'right'
}>(), {
  secondary: undefined,
  align: 'center',
})

function isExternal(href: string) {
  return /^https?:\/\//.test(href)
}
</script>
