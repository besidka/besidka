<template>
  <div
    v-if="error"
    class="alert alert-error alert-soft flex flex-col items-start gap-0 mt-2"
  >
    <p
      v-for="(line, lineIndex) in buildChatErrorLines(error)"
      :key="`chat-error-card-line-${lineIndex}`"
    >
      {{ line }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'

defineProps<{
  error: ChatErrorPayload | null
}>()
</script>
