<template>
  <div
    v-if="notice"
    class="shrink-0 px-3 pb-1 sm:px-4"
    :class="isChatPage ? 'pt-[calc(var(--sat)_+_0.5rem)]' : 'pt-2'"
    data-testid="legal-change-notice"
  >
    <div
      role="status"
      class="alert alert-info alert-soft mx-auto max-w-4xl gap-2 py-2 text-xs sm:text-sm"
    >
      <Icon
        name="lucide:info"
        size="18"
        class="shrink-0"
      />
      <span class="min-w-0 flex-1">
        Changes to the {{ documentsLabel }} take effect on
        {{ effectiveDateLabel }}.
        <NuxtLink
          :to="href"
          class="link whitespace-nowrap"
          data-testid="legal-change-notice-link"
        >
          See what changes
        </NuxtLink>
      </span>
      <UiButton
        circle
        ghost
        size="xs"
        text="Dismiss notice"
        icon-only
        icon-name="lucide:x"
        aria-label="Dismiss notice"
        data-testid="legal-change-notice-dismiss"
        @click="dismiss"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const { notice, documentsLabel, effectiveDateLabel, href, dismiss }
  = useLegalNoticeBanner()
const isVisibleState = useLegalNoticeVisibility()
const route = useRoute()

const isChatPage = computed<boolean>(() => {
  return route.name === 'chats-slug'
})

watchEffect(() => {
  isVisibleState.value = !!notice.value
})

onBeforeUnmount(() => {
  isVisibleState.value = false
})
</script>
