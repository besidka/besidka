<template>
  <div
    class="fixed top-4 sm:top-8 right-8 z-50 flex justify-center w-full sm:max-w-md pointer-events-none"
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
        class="alert block w-full p-0 border-0 shadow-lg"
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
</template>

<script setup lang="ts">
const messages = useMessages()
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
