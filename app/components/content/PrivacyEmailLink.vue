<template>
  <NuxtLink :href="`mailto:${privacyEmail}`">
    {{ privacyEmail }}
  </NuxtLink>
</template>

<script setup lang="ts">
const { privacyEmail } = useRuntimeConfig().public
</script>
