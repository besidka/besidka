<template>
  <article
    v-if="guide"
    class="max-w-3xl mx-auto w-full px-3 sm:px-6 py-10 flex flex-col gap-6"
    data-testid="key-guide"
  >
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl sm:text-4xl font-black text-base-content">
        {{ guide.title }}
      </h1>
      <p class="text-sm opacity-70">
        Last updated
        <time :datetime="guide.updatedAt">{{ formattedUpdatedAt }}</time>
      </p>
    </header>

    <aside
      class="rounded-box bg-base-200/60 border border-base-300 p-4
        flex flex-col gap-3"
      data-testid="key-guide-facts"
    >
      <h2 class="text-xs font-black uppercase tracking-wide opacity-70">
        What you need
      </h2>
      <dl class="grid gap-2 text-sm">
        <div class="flex flex-wrap gap-x-2">
          <dt class="font-bold">Payment card:</dt>
          <dd data-testid="key-guide-fact-card">
            {{ cardRequirement }}
          </dd>
        </div>
        <div
          v-if="guide.requirements.minimumTopUp"
          class="flex flex-wrap gap-x-2"
        >
          <dt class="font-bold">Minimum top-up:</dt>
          <dd data-testid="key-guide-fact-top-up">
            {{ guide.requirements.minimumTopUp }}
          </dd>
        </div>
        <div
          v-if="guide.requirements.freeTier"
          class="flex flex-wrap gap-x-2"
        >
          <dt class="font-bold">Free tier:</dt>
          <dd data-testid="key-guide-fact-free-tier">
            {{ guide.requirements.freeTier }}
          </dd>
        </div>
      </dl>
      <p class="text-xs opacity-70">
        Checked
        <time :datetime="guide.checkedAt">{{ formattedCheckedAt }}</time>.
        <template v-if="guide.requirements.sources.length">
          Sources:
          <template
            v-for="(source, index) in guide.requirements.sources"
            :key="source.url"
          >
            <a
              v-if="isSafeExternalUrl(source.url)"
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="link"
            >{{ source.label }}</a>
            <template v-else>{{ source.label }}</template><template
              v-if="index < guide.requirements.sources.length - 1"
            >, </template>
          </template>.
        </template>
      </p>
    </aside>

    <div
      v-if="guide.video"
      ref="videoContainer"
      class="w-full scroll-mt-24"
      data-testid="key-guide-video"
    >
      <ClientOnly>
        <LazyLandingVideoPlayer
          :src="guide.video.src"
          :poster="guide.video.poster"
          :caption="guide.video.caption"
          :captions="guide.video.captions ?? []"
          :markers="guide.video.markers ?? []"
          :guide-provider="guide.provider"
          :start-at="videoStartAt"
        />
        <template #fallback>
          <img
            v-if="guide.video.poster"
            :src="guide.video.poster"
            alt=""
            width="1920"
            height="1080"
            loading="lazy"
            decoding="async"
            class="w-full aspect-video rounded-2xl object-cover bg-base-300
              ring-1 ring-base-content/10 shadow-xl"
          >
          <div
            v-else
            class="skeleton skeleton--default w-full aspect-video
              rounded-2xl"
          />
        </template>
      </ClientOnly>
    </div>

    <ContentRenderer
      :value="guide"
      tag="div"
      class="prose prose-sm sm:prose-base max-w-none
        prose-headings:scroll-mt-24"
    />

    <a
      v-if="isSafeExternalUrl(guide.keyUrl)"
      :href="guide.keyUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="btn btn-outline self-start"
      data-testid="key-guide-key-link"
    >
      {{ guide.keyUrlLabel || 'Open the official key page' }}
      <Icon
        name="lucide:external-link"
        size="16"
        aria-hidden="true"
      />
      <span class="sr-only">(opens in new tab)</span>
    </a>

    <section
      class="rounded-box bg-base-200/60 border border-base-300 p-4
        flex flex-col gap-3"
      data-testid="key-guide-cta"
    >
      <h2 class="text-xl font-black">Got your key? Use it in Besidka</h2>
      <p class="text-sm opacity-80">
        Paste the key once and chat with every model it unlocks. You pay the
        provider directly for what you use.
      </p>
      <div class="flex flex-wrap gap-3">
        <NuxtLink
          :to="signupLink"
          class="btn btn-primary"
          data-testid="key-guide-signup-link"
        >
          Add your key to Besidka
        </NuxtLink>
        <NuxtLink
          to="/byok"
          class="btn btn-ghost"
          data-testid="key-guide-byok-link"
        >
          How bringing your own key works
        </NuxtLink>
      </div>
    </section>
  </article>
</template>

<script setup lang="ts">
import { buildKeyGuidePageLd } from '~/utils/landing-jsonld'
import { formatUtcDate } from '~/utils/utc-date'
import { isSafeExternalUrl } from '#shared/utils/external-url'
import {
  parseIsoDurationToSeconds,
  parseVideoStartOffset,
} from '#shared/utils/video'

definePageMeta({
  layout: 'legal',
})

const { baseUrl } = useRuntimeConfig().public
const siteOrigin = (baseUrl as string) || useRequestURL().origin
const route = useRoute()
const { withUtm } = useUtmAttribution()

const slug = computed<string>(() => {
  return String(route.params.slug ?? '')
})

const asyncDataKey = computed<string>(() => `key-guide-${slug.value}`)

const { data: guide } = await useAsyncData(
  asyncDataKey,
  () => queryCollection('keyGuides').path(`/guides/${slug.value}`).first(),
)

if (!guide.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Guide not found',
    fatal: true,
  })
}

const title = computed<string>(() => guide.value?.title ?? '')
const description = computed<string>(() => guide.value?.description ?? '')
const formattedUpdatedAt = computed<string>(() => {
  return formatUtcDate(guide.value?.updatedAt)
})
const formattedCheckedAt = computed<string>(() => {
  return formatUtcDate(guide.value?.checkedAt)
})
const cardRequirement = computed<string>(() => {
  const requirements = guide.value?.requirements

  if (requirements?.cardNote) {
    return requirements.cardNote
  }

  return requirements?.card ? 'Required' : 'Not required'
})

const videoContainer = useTemplateRef<HTMLElement>('videoContainer')

const videoStartAt = computed<number | undefined>(() => {
  const duration = guide.value?.video?.duration

  if (!duration) {
    return undefined
  }

  return parseVideoStartOffset(
    route.query.t,
    parseIsoDurationToSeconds(duration),
  ) ?? undefined
})

const signupLink = computed<string>(() => {
  const keysPath = resolveSafeNextPath(
    `/profile/keys?provider=${guide.value?.provider ?? ''}`,
  )

  return withUtm(appendNextToPath('/signup', keysPath))
})

onMounted(async () => {
  if (videoStartAt.value === undefined) {
    return
  }

  await nextTick()
  videoContainer.value?.scrollIntoView({
    block: 'start',
    behavior: 'instant',
  })
})

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
        dateModified: guide.value?.updatedAt,
        video: guide.value?.video,
      })).replace(/</g, '\\u003c'),
    },
  ],
})
</script>
