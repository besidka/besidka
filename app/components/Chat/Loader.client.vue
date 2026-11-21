<template>
  <div
    data-testid="chat-loader"
    class="relative h-0 w-full sm:w-4xl sm:max-w-chat-column mt-3 mx-auto px-4 sm:px-24"
    :class="{
      'opacity-0 pointer-events-none': !show,
    }"
  >
    <div class="absolute top-0">
      <div
        class="chat chat-start w-fit"
      >
        <div
          class="chat-image avatar avatar-placeholder rounded-full overflow-visible"
          :class="{
            'max-sm:hidden': hideAssistantAvatarOnMobile,
          }"
        >
          <div class="bubble w-9 rounded-full bg-base-100 dark:bg-base-content/50">
            <Logo
              short
              animate
              class="size-5 text-text dark:text-base-100 motion-safe:animate-zoom"
            />
          </div>
        </div>
        <UiBubble class="chat-bubble py-3.5 shadow-none w-full">
          <div
            v-if="waitingSeconds !== null"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            role="status"
            data-testid="chat-loader-waiting"
          >
            <SvgoLoader class="w-4" />
            <span>
              Waiting for the previous reply to stop… {{ waitingSeconds }}s
            </span>
            <button
              type="button"
              class="link link-hover"
              data-testid="chat-loader-waiting-cancel"
              @click="emit('cancel')"
            >
              Cancel
            </button>
          </div>
          <template v-else>
            <SvgoLoader class="w-4" />
            <span class="sr-only">Loading</span>
          </template>
        </UiBubble>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  show?: boolean
  hideAssistantAvatarOnMobile?: boolean
  waitingSince?: number
}>(), {
  show: false,
  hideAssistantAvatarOnMobile: false,
  waitingSince: 0,
})

const emit = defineEmits<{
  cancel: []
}>()

const now = shallowRef<number>(Date.now())

const { pause, resume } = useIntervalFn(() => {
  now.value = Date.now()
}, 1000, { immediate: false })

watch(() => props.waitingSince, (since) => {
  now.value = Date.now()

  if (since > 0) {
    resume()

    return
  }

  pause()
}, { immediate: true })

const waitingSeconds = computed<number | null>(() => {
  if (!props.waitingSince) {
    return null
  }

  return Math.max(0, Math.round((now.value - props.waitingSince) / 1000))
})
</script>
