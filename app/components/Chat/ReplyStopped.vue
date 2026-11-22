<template>
  <p
    v-if="isTextlessStoppedReply(message.parts)"
    class="mt-2 text-sm text-base-content/60"
    data-testid="reply-stopped"
  >
    Stopped.
  </p>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import { isTextlessStoppedReply } from '#shared/utils/chat-reply-stopped'

defineProps<{
  message: UIMessage
}>()
</script>
