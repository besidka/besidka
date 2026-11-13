<template>
  <Teleport
    :to="topDialog ?? 'body'"
    :disabled="!topDialog"
  >
    <div
      class="js-messages side-panel-follow side-panel-seam-right fixed top-0 sm:top-8 right-0 sm:right-[calc(var(--side-panel-width,0px)+2rem)] z-[70] flex justify-center w-full sm:max-w-md pointer-events-none"
    >
      <TransitionGroup
        name="messages"
        tag="div"
        class="stack grid gap-2 w-full"
        :class="{
          'pointer-events-auto': !!messages.length,
        }"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          role="alert"
          class="alert alert-soft block w-full p-0 border-0 !shadow-lg max-sm:!rounded-none"
          :class="{
            'alert-error': message.type === 'error',
            'alert-success': message.type === 'success',
            'alert-info': message.type === 'info',
            'alert-warning': message.type === 'warning',
          }"
        >
          <LazyUiMessage :message="message" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const messages = useMessages()
const { topDialog, refresh: refreshTopDialog } = useTopModalDialog()

watch(() => messages.value.length, refreshTopDialog)
</script>

<style scoped>
@reference "~/assets/css/main.css";

.messages-move,
.messages-enter-active,
.messages-leave-active {
    @apply transition-all duration-500;
}

.messages-enter-from,
.messages-leave-to {
    @apply opacity-0 invisible -translate-x-8 sm:translate-y-0 sm:translate-x-8;
}

.messages-leave-active {
    @apply absolute;
}
</style>
