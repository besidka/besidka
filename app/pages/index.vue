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
import {
  buildFaqPageLd,
  buildOrganizationLd,
  buildSoftwareApplicationLd,
} from '~/utils/landing-jsonld'

const { themeColor } = useAppConfig()

type FaqItem = { question: string, answer: string }
type HomeData = Record<string, unknown>

definePageMeta({
  layout: 'landing',
})

const { baseUrl } = useRuntimeConfig().public

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

const fullTitle = computed(() => {
  const chunk = page.value?.title
  return chunk ? `${chunk} | Besidka` : 'Besidka'
})

useSeoMeta({
  title: () => page.value?.title || null,
  ogTitle: () => fullTitle.value,
  description: () => description.value,
  ogDescription: () => description.value,
  ogUrl: baseUrl as string,
  ogType: 'website',
  ogImage: `${baseUrl}/og-image.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogSiteName: 'Besidka',
  ogLocale: 'en_US',
  twitterCard: 'summary_large_image',
  twitterTitle: () => fullTitle.value,
  twitterDescription: () => description.value,
  twitterImage: `${baseUrl}/og-image.png`,
  twitterSite: '@besidka_ai',
  robots: 'index, follow',
})

useHead({
  link: [
    { rel: 'canonical', href: baseUrl as string },
  ],
  meta: [
    {
      name: 'theme-color',
      content: themeColor.light,
    },
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify(buildSoftwareApplicationLd({
        baseUrl: baseUrl as string,
        siteName: 'Besidka',
        description: description.value,
      })).replace(/</g, '\\u003c'),
    },
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify(buildOrganizationLd({
        baseUrl: baseUrl as string,
        siteName: 'Besidka',
      })).replace(/</g, '\\u003c'),
    },
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify(
        buildFaqPageLd(faqs.value),
      ).replace(/</g, '\\u003c'),
    },
  ],
})

onMounted(async () => {
  await nextTick()

  const { hash } = window.location

  if (!hash) {
    return
  }

  const target = document.querySelector<HTMLElement>(hash)

  if (!target) {
    return
  }

  // Deep links / reloads jump instantly; in-page anchor clicks stay smooth
  // (the scroll container has scroll-smooth in app.vue). We temporarily
  // disable smooth scrolling on the scroller for this one programmatic jump.
  const scroller = target.closest<HTMLElement>('.overflow-y-auto')
  const previousBehavior = scroller?.style.scrollBehavior

  if (scroller) {
    scroller.style.scrollBehavior = 'auto'
  }

  target.scrollIntoView({ block: 'start' })

  if (scroller) {
    scroller.style.scrollBehavior = previousBehavior || ''
  }
})
</script>
