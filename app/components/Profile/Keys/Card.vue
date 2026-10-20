<template>
  <details
    :name="group"
    :open="open"
    class="group collapse"
    data-testid="key-card"
    @toggle="onToggle"
  >
    <summary
      class="collapse-title flex min-h-0 items-center gap-3 px-0 py-1"
      :data-testid="`key-card-summary-${providerId}`"
      @click="onSummaryClick"
    >
      <ProviderIcon
        :provider-id="providerId"
        :label="label"
        class="!size-5 shrink-0"
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

<script setup lang="ts" vapor>
import type { KeyGuideOpenTrigger } from '#shared/types/analytics.d'
import type { UserKeyStatus } from '~/composables/user-keys'

const props = withDefaults(defineProps<{
  providerId: string
  label: string
  status: UserKeyStatus
  group?: string
  open?: boolean
}>(), {
  group: undefined,
  open: false,
})

const emit = defineEmits<{
  expandedChange: [isExpanded: boolean, trigger: KeyGuideOpenTrigger]
}>()

let lastReportedExpanded = false
let isUserToggle = false

function reportExpanded(
  isExpanded: boolean,
  trigger: KeyGuideOpenTrigger,
) {
  if (isExpanded === lastReportedExpanded) {
    return
  }

  lastReportedExpanded = isExpanded
  emit('expandedChange', isExpanded, trigger)
}

watch(() => props.open, (isOpen) => {
  reportExpanded(isOpen, 'auto')
}, { flush: 'post' })

onMounted(() => {
  reportExpanded(props.open, 'auto')
})

function onSummaryClick() {
  isUserToggle = true
}

function onToggle(event: Event) {
  const trigger: KeyGuideOpenTrigger = isUserToggle ? 'user' : 'auto'

  isUserToggle = false
  reportExpanded((event.target as HTMLDetailsElement).open, trigger)
}
</script>
