<template>
  <div class="flex flex-col">
    <LandingHero
      v-if="hero"
      :eyebrow="hero.eyebrow"
      :headline="hero.headline"
      :subheadline="hero.subheadline"
      :primary-cta="hero.primaryCta"
      :secondary-cta="hero.secondaryCta"
    />

    <div id="content" class="h-24 -mt-24"/>

    <ContentRenderer
      v-if="page"
      :value="page"
      tag="div"
      class="flex flex-col gap-2 sm:gap-3 max-w-3xl mx-auto
        w-full px-3 sm:px-6 pb-12"
    />
  </div>
</template>

<script setup lang="ts">
import type { FaqItem } from '~/utils/landing-jsonld'
import { buildLandingGraphLd } from '~/utils/landing-jsonld'

const { siteName, themeColor } = useAppConfig()

type HomeData = Record<string, unknown>

definePageMeta({
  layout: 'landing',
})

const { baseUrl } = useRuntimeConfig().public

const siteOrigin = (baseUrl as string) || useRequestURL().origin

// Provided synchronously (before the await below) so MDC-rendered widgets
// can inject their data. All structured data lives in frontmatter (page
// settings in Studio) and is forwarded here to inject('home:data').
// Keys: carousel, steps, features, useCases, faqs, benefits, comparison,
// video.
const homeData = shallowRef<HomeData>({})

provide('home:data', homeData)

const { data: page } = await useAsyncData(
  'landing-page',
  () => queryCollection('landing').path('/').first(),
  {
    getCachedData: (key, nuxtApp) => {
      return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
    },
  },
)

homeData.value = {
  carousel: page.value?.carousel ?? [],
  steps: page.value?.steps ?? [],
  features: page.value?.features ?? [],
  useCases: page.value?.useCases ?? [],
  faqs: page.value?.faqs ?? [],
  benefits: page.value?.benefits ?? [],
  comparison: page.value?.comparison ?? null,
  video: page.value?.video ?? null,
}

const faqs = computed<FaqItem[]>(() => {
  return (page.value?.faqs as FaqItem[] | undefined) ?? []
})

const hero = computed(() => page.value?.hero)
const description = computed<string>(() => page.value?.description ?? '')

// Brand-first; `titleTemplate: null` below stops the brand appearing twice.
const fullTitle = computed<string>(() => {
  const chunk = page.value?.title

  return chunk ? `${siteName} — ${chunk}` : siteName
})

useSeoMeta({
  title: () => fullTitle.value,
  ogTitle: () => fullTitle.value,
  description: () => description.value,
  ogDescription: () => description.value,
  ogType: 'website',
  ogImage: buildCanonicalUrl(siteOrigin, '/og-image.png'),
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogSiteName: 'Besidka',
  ogLocale: 'en_US',
  twitterCard: 'summary_large_image',
  twitterTitle: () => fullTitle.value,
  twitterDescription: () => description.value,
  twitterImage: buildCanonicalUrl(siteOrigin, '/og-image.png'),
  twitterSite: '@besidka_ai',
  robots: 'index, follow',
})

useHead({
  titleTemplate: null,
  meta: [
    {
      name: 'theme-color',
      content: themeColor.light,
    },
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify(buildLandingGraphLd({
        baseUrl: siteOrigin,
        siteName: siteName as string,
        description: description.value,
        faqs: faqs.value,
      })).replace(/</g, '\\u003c'),
    },
  ],
})

onMounted(async () => {
  await nextTick()

  scrollToHash(window.location.hash, { instant: true })
})
</script>
