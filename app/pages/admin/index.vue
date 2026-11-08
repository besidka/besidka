<template>
  <div />
</template>
<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Admin',
  robots: 'noindex, nofollow',
})

await navigateTo('/admin/features', { replace: true })
</script>
