<template>
  <div
    class="min-w-0 rounded-box bg-base-200 p-2 text-xs"
    data-testid="reasoning-approval-step-gmail-draft"
  >
    <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
      <template
        v-for="row in recipientRows"
        :key="row.label"
      >
        <dt class="text-base-content/60">
          {{ row.label }}
        </dt>
        <dd
          class="min-w-0 break-all"
          :data-testid="`reasoning-approval-step-gmail-draft-${row.key}`"
        >
          <span
            v-for="address in row.addresses"
            :key="address"
            class="block"
          >{{ address }}</span>
        </dd>
      </template>
      <dt class="text-base-content/60">
        Subject
      </dt>
      <dd
        class="min-w-0 break-words font-medium"
        data-testid="reasoning-approval-step-gmail-draft-subject"
      >
        {{ view.subject }}
      </dd>
    </dl>
    <p
      class="mt-2 text-base-content/60"
      data-testid="reasoning-approval-step-gmail-draft-lines"
    >
      Message{{ replyNote }} · {{ lineCountText }}
    </p>
    <p
      class="mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-box outline-offset-2 focus:outline-2 focus:outline-accent"
      tabindex="0"
      role="region"
      aria-label="Draft message"
      data-testid="reasoning-approval-step-gmail-draft-body"
    >{{ view.cardBody }}</p>
    <p
      class="mt-2 text-base-content/60"
      data-testid="reasoning-approval-step-gmail-draft-note"
    >
      This only saves a draft in your Gmail. Besidka cannot send it.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { GmailDraftApprovalView } from '#shared/utils/google-gmail-draft-view'

const props = defineProps<{
  view: GmailDraftApprovalView
}>()

const replyNote = computed<string>(() => {
  return props.view.isReply ? ' (a reply in the thread above)' : ''
})

const lineCountText = computed<string>(() => {
  const count = props.view.lineCount

  return count === 1 ? '1 line' : `${count} lines`
})

const recipientRows = computed(() => {
  return [
    { key: 'to', label: 'To', addresses: props.view.to },
    { key: 'cc', label: 'Cc', addresses: props.view.cc },
    { key: 'bcc', label: 'Bcc', addresses: props.view.bcc },
  ].filter(row => row.addresses.length > 0)
})
</script>
