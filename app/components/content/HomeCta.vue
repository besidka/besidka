<template>
  <LandingCtaButtons
    :primary="primary"
    :secondary="secondary"
    :align="align"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  primary: { label: string, href: string, icon?: string }
  secondary?: { label: string, href: string, icon?: string }
  align?: 'left' | 'center' | 'right'
}>(), {
  secondary: undefined,
  align: 'left',
})
</script>
