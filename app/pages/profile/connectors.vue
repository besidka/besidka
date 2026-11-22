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

const route = useRoute()

await navigateTo(
  { path: '/chats/connectors', query: route.query },
  { redirectCode: 301 },
)
</script>
