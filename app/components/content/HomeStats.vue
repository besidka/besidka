<template>
  <LandingStatGrid :metrics="metrics" />
</template>

<script setup lang="ts">
import type { StatMetric } from '#shared/types/landing.d'

type HomeStatCard = {
  metric: StatMetric
  label: string
  icon?: string
}

withDefaults(defineProps<{
  metrics?: HomeStatCard[]
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
      metric: 'uploadedFiles',
      label: 'Files uploaded',
      icon: 'lucide:paperclip',
    },
    {
      metric: 'generatedImages',
      label: 'Images generated',
      icon: 'lucide:image',
    },
    {
      metric: 'sharedChats',
      label: 'Conversations shared',
      icon: 'lucide:share-2',
    },
  ],
})
</script>
