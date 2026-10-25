<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Memory</h1>
    <h2 class="mt-2">Control what the assistant remembers about you</h2>
  </div>
  <div class="grid gap-6">
    <ProfileMemoryControls
      :settings="values"
      :save="saveSettings"
    />
    <ProfileMemoryNeverKept />
    <ProfileMemoryModels
      :settings="values"
      :save="saveSettings"
    />
    <ProfileMemoryCacheInfo />
    <ProfileMemoryEntries
      :settings="values"
      :about-me-not-migrated-reason="aboutMeNotMigratedReason"
      @about-me-removed="clearAboutMe"
    />
  </div>
</template>

<script setup lang="ts">
import type { AboutMeNotMigratedReason } from '#shared/types/memory.d'
import type { MemorySettingsSave } from '~/types/memory-settings.d'

const MEMORY_ENTRIES_KEY = 'memory-entries:all'

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

const { data: settings, refresh: refreshSettings } = await useFetch('/api/v1/profiles/settings', {
  key: 'profile-memory-settings',
})

const { values, save } = useMemorySettingsSaver(settings)

const saveSettings: MemorySettingsSave = async (patch) => {
  const wasMemoryEnabled = values.value.memoryEnabled
  const outcome = await save(patch)

  if (outcome.ok && patch.memoryEnabled === true && !wasMemoryEnabled) {
    await Promise.all([
      refreshSettings(),
      refreshNuxtData(MEMORY_ENTRIES_KEY),
    ])
  }

  return outcome
}

const aboutMeNotMigratedReason = computed<AboutMeNotMigratedReason | null>(
  () => {
    const response = settings.value as {
      aboutMeNotMigratedReason?: AboutMeNotMigratedReason | null
    } | null

    return response?.aboutMeNotMigratedReason ?? null
  },
)

function clearAboutMe() {
  if (!settings.value) {
    return
  }

  settings.value = { ...settings.value, aboutMe: null }
}
</script>
