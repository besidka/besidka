<template>
  <ProfileSecuritySectionCard
    heading="Models for memory"
    :description="description"
  >
    <div class="grid gap-6">
      <ClientOnly>
        <LazyProfileMemoryModelPicker
          label="Profile memory model"
          :model-value="profileChoice"
          :recommended-model-ids="recommendedModelIds"
          @update:model-value="onProfileChange"
        />
        <LazyProfileMemoryModelPicker
          label="Project memory model"
          :model-value="projectChoice"
          :recommended-model-ids="recommendedModelIds"
          @update:model-value="onProjectChange"
        />
        <template #fallback>
          <div
            v-for="pickerIndex in 2"
            :key="pickerIndex"
            class="grid gap-3"
            data-testid="memory-model-picker-skeleton"
          >
            <div class="skeleton skeleton--default h-5 w-40" />
            <div class="skeleton skeleton--default h-32 w-full" />
          </div>
        </template>
      </ClientOnly>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import type { GatewayId } from '#shared/types/gateways.d'
import type { MemorySettingsFields } from '#shared/types/memory.d'
import type { MemorySettingsSave } from '~/types/memory-settings.d'

interface ModelChoice {
  model: string
  gateway: GatewayId | null
}

const props = defineProps<{
  settings: MemorySettingsFields
  save: MemorySettingsSave
}>()

const description = 'Memory generation runs on your own API keys. '
  + 'Pick which model does the work.'

const { providers } = getProviders()

const recommendedModelIds = computed<string[]>(() => {
  return providers.flatMap((provider) => {
    return provider.models
      .filter(model => model.forProjectMemory)
      .map(model => model.id)
  })
})

const profileChoice = computed<ModelChoice | null>(() => {
  if (!props.settings.profileMemoryModel) {
    return null
  }

  return {
    model: props.settings.profileMemoryModel,
    gateway: props.settings.profileMemoryGateway,
  }
})

const projectChoice = computed<ModelChoice | null>(() => {
  if (!props.settings.projectMemoryModel) {
    return null
  }

  return {
    model: props.settings.projectMemoryModel,
    gateway: props.settings.projectMemoryGateway,
  }
})

async function saveChoice(patch: Partial<MemorySettingsFields>) {
  const outcome = await props.save(patch)

  if (outcome.ok) {
    return
  }

  useErrorMessage(
    outcome.parsed.message || 'Failed to save memory settings.',
    outcome.parsed.why,
  )
}

async function onProfileChange(choice: ModelChoice | null) {
  await saveChoice({
    profileMemoryModel: choice?.model ?? null,
    profileMemoryGateway: choice?.gateway ?? null,
  })
}

async function onProjectChange(choice: ModelChoice | null) {
  await saveChoice({
    projectMemoryModel: choice?.model ?? null,
    projectMemoryGateway: choice?.gateway ?? null,
  })
}
</script>
