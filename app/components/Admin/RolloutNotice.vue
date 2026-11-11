<template>
  <div
    role="note"
    class="alert alert-warning alert-soft text-sm"
    data-testid="admin-rollout-notice"
  >
    <Icon
      name="lucide:info"
      size="16"
      class="shrink-0"
      aria-hidden="true"
    />
    <span>
      Gradual rollouts and variants are off.
      <span data-testid="admin-rollout-notice-gate">
        {{ gate?.description ?? fallbackDescription }}
      </span>
      Until then, grant features only to the owner and to testers who were
      told individually. Rollout steps you schedule wait and apply on their
      own.
    </span>
  </div>
</template>
<script setup lang="ts">
import type { AdminRolloutGateView } from '~/utils/admin-schedule'

const fallbackDescription = 'They open once the Privacy notice is in force.'

defineProps<{
  gate?: AdminRolloutGateView
}>()
</script>
