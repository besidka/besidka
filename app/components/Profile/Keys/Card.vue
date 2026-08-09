<template>
  <details
    :name="group"
    :open="open"
    class="group collapse"
    data-testid="key-card"
  >
    <summary
      class="collapse-title flex min-h-0 items-center gap-3 px-0 py-1"
      :data-testid="`key-card-summary-${providerId}`"
    >
      <ProviderIcon
        :provider-id="providerId"
        :label="label"
        class="!size-8 shrink-0"
      />
      <span class="grow truncate text-left text-lg font-bold">
        {{ label }}
      </span>
      <span
        v-if="status === 'saved'"
        class="badge badge-soft badge-success badge-sm gap-1"
        data-testid="key-status-saved"
      >
        <Icon
          name="lucide:circle-check"
          size="12"
        />
        <span class="max-xs:sr-only">Key saved</span>
      </span>
      <span
        v-else-if="status === 'missing'"
        class="badge badge-soft badge-warning badge-sm gap-1"
        data-testid="key-status-missing"
      >
        <Icon
          name="lucide:circle-alert"
          size="12"
        />
        <span class="max-xs:sr-only">No key</span>
      </span>
      <Icon
        name="lucide:chevron-right"
        size="18"
        class="shrink-0 text-base-content/60 transition-transform group-open:rotate-90"
      />
    </summary>
    <div class="collapse-content mt-3 px-0 pb-0">
      <slot />
    </div>
  </details>
</template>

<script setup lang="ts">
import type { UserKeyStatus } from '~/composables/user-keys'

withDefaults(defineProps<{
  providerId: string
  label: string
  status: UserKeyStatus
  group?: string
  open?: boolean
}>(), {
  group: undefined,
  open: false,
})
</script>
