<template>
  <LegalDocument :doc="page" />
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'legal',
})

const { data: page } = await useAsyncData('legal-terms-of-use', () => {
  return queryCollection('legal').path('/legal/terms-of-use').first()
})

useSeoMeta({
  title: () => page.value?.title || 'Terms of Use',
  description: () => page.value?.description || '',
})
</script>
