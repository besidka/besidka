<template>
  <LegalDocument :doc="page" />
</template>

<script setup lang="ts">
import { buildGuidePageLd } from '~/utils/landing-jsonld'

definePageMeta({
  layout: 'legal',
})

const { baseUrl } = useRuntimeConfig().public
const siteOrigin = (baseUrl as string) || useRequestURL().origin
const route = useRoute()

const { data: page } = await useAsyncData('guide-byok', () => {
  return queryCollection('guides').path('/guides/byok').first()
})

const title = computed<string>(() => {
  return page.value?.title || 'Bring your own API key'
})
const description = computed<string>(() => page.value?.description || '')

useSeoMeta({
  title: () => title.value,
  ogTitle: () => title.value,
  description: () => description.value,
  ogDescription: () => description.value,
  ogType: 'article',
})

useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify(buildGuidePageLd({
        baseUrl: siteOrigin,
        url: buildCanonicalUrl(siteOrigin, route.path),
        headline: title.value,
        description: description.value,
        dateModified: page.value?.updatedAt,
      })).replace(/</g, '\\u003c'),
    },
  ],
})
</script>
