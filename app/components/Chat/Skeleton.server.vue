<template>
  <div class="grid gap-3 w-full sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24">
    <div
      v-for="(_, index) in Array(Math.min(messagesLength, 2))"
      :key="index"
      class="chat w-full"
      :class="{
        'chat-end': !(index % 2),
        'chat-start': index % 2,
      }"
    >
      <div
        class="chat-image avatar avatar-placeholder rounded-full"
        :class="{
          'max-sm:hidden': index % 2,
        }"
      >
        <div class="w-9 rounded-full skeleton opacity-50 dark:opacity-30"/>
      </div>
      <UiBubble
        class="chat-bubble sm:!px-6 !shadow-none w-full skeleton opacity-50 dark:opacity-30 !rounded-2xl"
        :class="{
          'h-11 !rounded-br-none': !(index % 2),
          'h-20 !rounded-bl-none': index % 2,
        }"
      >
        <span class="invisible">Loading</span>
      </UiBubble>
    </div>
  </div>
</template>
<script setup lang="ts">
defineProps<{
  messagesLength: number
}>()
</script>
