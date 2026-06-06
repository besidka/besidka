<template>
  <LandingStatGrid :metrics="metrics" />
</template>

<script setup lang="ts">
type StatMetric = {
  metric: 'users' | 'chats' | 'messages' | 'files'
  label: string
  icon?: string
}

withDefaults(defineProps<{
  metrics?: StatMetric[]
}>(), {
  metrics: () => [
    {
      metric: 'users',
      label: 'People using Besidka',
      icon: 'lucide:users',
    },
    {
      metric: 'chats',
      label: 'Conversations started',
      icon: 'lucide:message-square',
    },
    {
      metric: 'messages',
      label: 'Messages exchanged',
      icon: 'lucide:messages-square',
    },
    {
      metric: 'files',
      label: 'Files attached',
      icon: 'lucide:paperclip',
    },
  ],
})
</script>
