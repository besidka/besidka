<template>
  <div
    v-if="!hasError"
    class="w-full"
    :aria-label="caption || 'Besidka demo video'"
  >
    <div class="relative w-full aspect-video rounded-xl overflow-hidden">
      <video
        ref="videoRef"
        class="w-full h-full object-cover"
        :src="src"
        :poster="poster || undefined"
        controls
        playsinline
        preload="metadata"
        @play="handlePlay"
        @ended="handleEnded"
        @error="handleError"
      >
        <track
          v-if="captions"
          kind="captions"
          :src="captions"
          srclang="en"
          label="English"
        >
        <p class="sr-only">
          Your browser does not support the video element.
        </p>
      </video>
    </div>
    <p
      v-if="caption"
      class="text-sm text-base-content/60 text-center mt-3"
    >
      {{ caption }}
    </p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  src: string
  poster?: string
  caption?: string
  captions?: string
}>(), {
  poster: undefined,
  caption: undefined,
  captions: undefined,
})

const { track } = useLandingAnalytics()

const videoRef = shallowRef<HTMLVideoElement | null>(null)
const hasError = shallowRef<boolean>(false)
const hasPlayed = shallowRef<boolean>(false)

function handlePlay() {
  if (hasPlayed.value) {
    return
  }

  hasPlayed.value = true
  track('video_play', { target: 'demo' })
}

function handleEnded() {
  track('video_complete', { target: 'demo' })
}

function handleError() {
  hasError.value = true
}
</script>
