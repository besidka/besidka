<template>
  <LandingCtaButtons
    :primary="primary"
    :secondary="secondary"
    :align="align"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  primary: { label: string, href: string }
  secondary?: { label: string, href: string }
  align?: 'left' | 'center' | 'right'
}>(), {
  secondary: undefined,
  align: 'left',
})
</script>
