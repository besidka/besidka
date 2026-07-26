<template>
  <LegalDocument :doc="page" />
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'legal',
})

const { data: page } = await useAsyncData('legal-privacy-policy', () => {
  return queryCollection('legal').path('/legal/privacy-policy').first()
})

useSeoMeta({
  title: () => page.value?.title || 'Privacy Policy',
  description: () => page.value?.description || '',
})
</script>
