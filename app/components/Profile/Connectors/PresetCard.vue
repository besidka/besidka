<template>
  <li
    class="card card-border card-sm"
    :data-testid="`connector-preset-${preset.id}`"
  >
    <div class="card-body gap-2">
      <div class="flex items-center gap-3">
        <ProfileConnectorsAvatar
          :title="preset.title"
          :preset-id="preset.id"
          size="lg"
        />
        <div class="min-w-0 grow">
          <p class="truncate font-medium">
            {{ preset.title }}
          </p>
          <p class="text-xs text-base-content/70">
            {{ authLabel }}
          </p>
        </div>
      </div>
      <p
        v-if="preset.notice"
        class="text-xs text-base-content/70"
      >
        {{ preset.notice }}
      </p>
      <button
        type="button"
        class="btn btn-sm min-h-11 sm:min-h-8"
        :class="{ 'btn-primary': !isAdded }"
        :disabled="isBusy || isAdded"
        :aria-label="`${isAdded ? 'Added' : 'Add'} ${preset.title}`"
        :data-testid="`connector-preset-add-${preset.id}`"
        @click="emit('add', preset.id)"
      >
        {{ isAdded ? 'Added' : 'Add' }}
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { ConnectorPreset } from '~~/config/connectors-catalog'

const props = defineProps<{
  preset: ConnectorPreset
  isAdded: boolean
  isBusy: boolean
}>()

const emit = defineEmits<{
  add: [presetId: string]
}>()

const authLabel = computed<string>(() => {
  return props.preset.auth.map((kind) => {
    return kind === 'oauth' ? 'Sign in' : 'API key or token'
  }).join(' or ')
})
</script>
