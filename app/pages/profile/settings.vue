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

await navigateTo('/profile/security', { redirectCode: 301 })
</script>
