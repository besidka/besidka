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
      metric: 'files',
      label: 'Files attached',
      icon: 'lucide:paperclip',
    },
    {
      metric: 'sharedChats',
      label: 'Conversations shared',
      icon: 'lucide:share-2',
    },
    {
      metric: 'researches',
      label: 'Research reports generated',
      icon: 'lucide:telescope',
    },
  ],
})
</script>
