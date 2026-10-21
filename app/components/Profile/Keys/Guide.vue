<template>
  <details
    v-if="doc"
    class="group/guide mt-4 rounded-box border border-base-300
      bg-base-200/40"
    :open="isOpen"
    :data-testid="`key-guide-${provider}`"
    @toggle="onToggle"
  >
    <summary
      class="flex cursor-pointer list-none items-center gap-2 px-4 py-3
        font-bold [&::-webkit-details-marker]:hidden"
      :data-testid="`key-guide-summary-${provider}`"
    >
      <Icon
        name="lucide:circle-question-mark"
        size="16"
        class="shrink-0"
      />
      <span class="grow">How to get a key</span>
      <Icon
        name="lucide:chevron-down"
        size="16"
        class="shrink-0 text-base-content/60 transition-transform
          group-open/guide:rotate-180"
      />
    </summary>
    <div class="grid gap-4 px-4 pb-4">
      <div
        v-if="doc.video"
        ref="videoBoxRef"
        class="relative w-full aspect-video rounded-2xl bg-base-300"
        :data-testid="`key-guide-video-${provider}`"
      >
        <img
          v-if="!shouldMountPlayer && !isPosterMissing"
          :src="doc.video.poster"
          :alt="videoLabel"
          width="1280"
          height="720"
          loading="lazy"
          class="size-full rounded-2xl object-contain"
          @error="isPosterMissing = true"
        >
        <LazyProfileKeysGuideVideo
          v-if="shouldMountPlayer"
          :provider="provider"
          :src="doc.video.src"
          :poster="doc.video.poster"
          :markers="doc.video.markers"
          :label="videoLabel"
          @failed="isVideoFailed = true"
        />
      </div>
      <p
        v-if="isVideoFailed"
        class="text-sm text-base-content/60"
        role="status"
        :data-testid="`key-guide-video-failed-${provider}`"
      >
        Video unavailable. Follow the steps below.
      </p>
      <p
        v-if="doc.summary"
        class="text-sm"
      >
        {{ doc.summary }}
      </p>
      <ContentRenderer
        :value="doc"
        tag="div"
        class="prose prose-sm max-w-none"
      />
      <section
        class="grid gap-2 rounded-box border border-base-300 p-3"
        :aria-labelledby="`key-guide-needs-${provider}`"
      >
        <h3
          :id="`key-guide-needs-${provider}`"
          class="text-xs font-black uppercase tracking-wide opacity-70"
        >
          What you need
        </h3>
        <dl class="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt class="font-bold">Card</dt>
          <dd>{{ cardRequirement }}</dd>
          <template v-if="doc.requirements.minimumTopUp">
            <dt class="font-bold">Minimum top-up</dt>
            <dd>{{ doc.requirements.minimumTopUp }}</dd>
          </template>
          <template v-if="doc.requirements.freeTier">
            <dt class="font-bold">Free tier</dt>
            <dd>{{ doc.requirements.freeTier }}</dd>
          </template>
        </dl>
        <p class="text-xs text-base-content/70">
          Checked
          <time :datetime="doc.checkedAt">{{ formattedCheckedAt }}</time>
          <template v-if="doc.requirements.sources.length">
            · Sources:
            <template
              v-for="(source, sourceIndex) in doc.requirements.sources"
              :key="source.url"
            >
              <span v-if="sourceIndex > 0">, </span>
              <NuxtLink
                :to="source.url"
                class="link"
                target="_blank"
                rel="noopener"
              >
                {{ source.label }}
              </NuxtLink>
            </template>
          </template>
        </p>
      </section>
      <UiButton
        :to="doc.keyUrl"
        target="_blank"
        rel="noopener"
        mode="default"
        outline
        normal-case
        icon-name="lucide:external-link"
        :icon-size="16"
        :text="openButtonText"
        class="w-full"
        :data-testid="`key-guide-open-${provider}`"
      />
    </div>
  </details>
</template>

<script setup lang="ts">
import type { KeyGuidesCollectionItem } from '@nuxt/content'
import type { KeyGuideOpenTrigger } from '#shared/types/analytics.d'
import { providerMeta } from '#shared/utils/provider-meta'
import type { UserKeyStatus } from '~/composables/user-keys'
import { formatUtcDate } from '~/utils/utc-date'

const props = withDefaults(defineProps<{
  provider: string
  status: UserKeyStatus
  doc?: KeyGuidesCollectionItem | null
  cardOpen?: boolean
  cardOpenTrigger?: KeyGuideOpenTrigger
}>(), {
  doc: null,
  cardOpen: true,
  cardOpenTrigger: 'auto',
})

const VIDEO_ROOT_MARGIN = '300px'

const { trackGuideOpen } = useKeyGuideAnalytics()

const videoBoxRef = shallowRef<HTMLElement | null>(null)
const isOpen = shallowRef<boolean>(false)
const isNearViewport = shallowRef<boolean>(false)
const isPosterMissing = shallowRef<boolean>(false)
const isVideoFailed = shallowRef<boolean>(false)

let hasSettledOpenState = false
let openTrigger: KeyGuideOpenTrigger = 'auto'

const shouldMountPlayer = computed<boolean>(() => {
  return isOpen.value && isNearViewport.value && !isVideoFailed.value
})

const isGuideVisible = computed<boolean>(() => {
  return !!props.doc && isOpen.value && props.cardOpen
})

const providerLabel = computed<string>(() => {
  return providerMeta[props.provider]?.label ?? props.provider
})

const videoLabel = computed<string>(() => {
  return props.doc?.video?.alt
    || `Video: how to get a ${providerLabel.value} API key`
})

const openButtonText = computed<string>(() => {
  return props.doc?.keyUrlLabel || `Open ${providerLabel.value} keys page`
})

const cardRequirement = computed<string>(() => {
  const requirements = props.doc?.requirements

  if (requirements?.cardNote) {
    return requirements.cardNote
  }

  return requirements?.card ? 'Required' : 'Not required'
})

const formattedCheckedAt = computed<string>(() => {
  return formatUtcDate(props.doc?.checkedAt)
})

const { stop: stopObservingVideo } = useIntersectionObserver(
  videoBoxRef,
  ([entry]) => {
    if (!entry?.isIntersecting) {
      return
    }

    isNearViewport.value = true
    stopObservingVideo()
  },
  {
    root: () => {
      return videoBoxRef.value?.closest('.js-page-content') ?? null
    },
    rootMargin: VIDEO_ROOT_MARGIN,
  },
)

watch(() => props.status, (status) => {
  if (hasSettledOpenState || status === 'unknown') {
    return
  }

  hasSettledOpenState = true
  isOpen.value = status === 'missing'
}, { immediate: true })

function resolveOpenTrigger(): KeyGuideOpenTrigger {
  return openTrigger === 'user' || props.cardOpenTrigger === 'user'
    ? 'user'
    : 'auto'
}

watch(isGuideVisible, (isVisible) => {
  if (isVisible) {
    trackGuideOpen(props.provider, resolveOpenTrigger())
  }
})

onMounted(() => {
  if (isGuideVisible.value) {
    trackGuideOpen(props.provider, resolveOpenTrigger())
  }
})

function onToggle(event: Event) {
  const nextOpen = (event.target as HTMLDetailsElement).open

  if (nextOpen === isOpen.value) {
    return
  }

  hasSettledOpenState = true

  if (nextOpen) {
    openTrigger = 'user'
  }

  isOpen.value = nextOpen
}
</script>
