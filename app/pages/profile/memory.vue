<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Memory</h1>
    <h2 class="mt-2">Control what the assistant remembers about you</h2>
  </div>
  <div class="grid gap-6">
    <ProfileMemoryControls
      :settings="values"
      :save="save"
    />
    <ProfileMemorySensitive
      :settings="values"
      :save="save"
    />
    <ProfileMemoryAboutMe
      :settings="values"
      :save="save"
    />
    <ProfileMemoryModels
      :settings="values"
      :save="save"
    />
    <ProfileMemoryEntries />
  </div>
</template>

<script setup lang="ts">
import type { MemorySettingsFields } from '#shared/types/memory.d'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Memory',
  robots: 'noindex, nofollow',
})

const { data: settings } = await useFetch<MemorySettingsFields>(
  '/api/v1/profiles/settings',
  { key: 'profile-memory-settings' },
)

const { values, save } = useMemorySettingsSaver(settings)
</script>
