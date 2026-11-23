<template>
  <div
    class="min-w-0 rounded-box bg-base-200 p-2 text-xs"
    data-testid="reasoning-approval-step-drive-change"
  >
    <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
      <dt class="text-base-content/60">
        New folder
      </dt>
      <dd
        class="min-w-0 break-words font-medium"
        data-testid="reasoning-approval-step-drive-change-name"
      >
        {{ view.name }}
      </dd>
      <dt class="text-base-content/60">
        Inside
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="reasoning-approval-step-drive-change-parent"
      >
        <template v-if="view.parent.isRoot">
          {{ GOOGLE_DRIVE_ROOT_CARD_LABEL }}
        </template>
        <template v-else>
          {{ parentName }}
          <span
            class="block break-all text-base-content/60"
            data-testid="reasoning-approval-step-drive-change-parent-id"
          >{{ view.parent.id }}</span>
        </template>
      </dd>
    </dl>
    <p
      class="mt-2 text-base-content/60"
      data-testid="reasoning-approval-step-drive-change-note"
    >
      {{ GOOGLE_DRIVE_WRITE_FOOTER }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  GOOGLE_DRIVE_ROOT_CARD_LABEL,
  GOOGLE_DRIVE_WRITE_FOOTER,
} from '#shared/utils/google-drive-write'
import type { DriveWriteApprovalView } from '#shared/utils/google-drive-write'

const props = defineProps<{
  view: DriveWriteApprovalView
}>()

const parentName = computed<string>(() => {
  const { name } = props.view.parent

  return name ? `“${name}”` : 'A folder from this chat'
})
</script>
