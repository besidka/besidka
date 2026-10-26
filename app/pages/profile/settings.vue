<template>
  <div />
</template>
<script setup lang="ts">
definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

await navigateTo('/profile/preferences', { redirectCode: 301 })
</script>
