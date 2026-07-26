<template>
  <LegalDocument :doc="page" />
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'legal',
})

const { data: page } = await useAsyncData('legal-cookie-policy', () => {
  return queryCollection('legal').path('/legal/cookie-policy').first()
})

useSeoMeta({
  title: () => page.value?.title || 'Cookie Policy',
  description: () => page.value?.description || '',
})
</script>
