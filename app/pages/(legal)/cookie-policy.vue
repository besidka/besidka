<template>
  <LegalDocument :doc="page" />
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'legal',
})

const { data: page } = await useLegalDocument()

useSeoMeta({
  title: () => page.value?.title || 'Cookie Policy',
  description: () => page.value?.description || '',
})
</script>
