<template>
  <LegalDocument :doc="page">
    <template
      v-if="page?.video"
      #media
    >
      <div
        class="w-full"
        data-testid="memory-guide-video"
      >
        <ClientOnly>
          <LazyProfileKeysGuideVideo
            explainer="memory"
            :src="page.video.src"
            :poster="page.video.poster"
            :label="page.video.alt || title"
            :qualities="page.video.qualities ?? []"
            :markers="page.video.markers ?? []"
          />
          <template #fallback>
            <img
              v-if="page.video.poster"
              :src="page.video.poster"
              :alt="page.video.alt || ''"
              width="1920"
              height="1080"
              loading="lazy"
              decoding="async"
              class="w-full aspect-video rounded-2xl object-contain bg-base-300
                ring-1 ring-base-content/10 shadow-xl"
            >
            <div
              v-else
              class="skeleton skeleton--default w-full aspect-video
                rounded-2xl"
            />
          </template>
        </ClientOnly>
        <p
          v-if="page.video.caption"
          class="mt-2 text-sm opacity-70"
        >
          {{ page.video.caption }}
        </p>
      </div>
    </template>
  </LegalDocument>
</template>

<script setup lang="ts">
import { buildKeyGuidePageLd } from '~/utils/landing-jsonld'

definePageMeta({
  layout: 'legal',
})

const { baseUrl } = useRuntimeConfig().public
const siteOrigin = (baseUrl as string) || useRequestURL().origin
const route = useRoute()

const { data: page } = await useAsyncData('guide-memory', () => {
  return queryCollection('guides').path('/guides/memory').first()
})

const title = computed<string>(() => {
  return page.value?.title || 'How memory works in Besidka'
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
      innerHTML: () => JSON.stringify(buildKeyGuidePageLd({
        baseUrl: siteOrigin,
        url: buildCanonicalUrl(siteOrigin, route.path),
        headline: title.value,
        description: description.value,
        dateModified: page.value?.updatedAt,
        video: page.value?.video,
      })).replace(/</g, '\\u003c'),
    },
  ],
})
</script>
