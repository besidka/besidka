<template>
  <div
    data-testid="gemini-paid-tier"
    class="mt-3 rounded-box bg-base-200/60 p-3"
  >
    <label class="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        data-testid="gemini-paid-tier-toggle"
        class="checkbox checkbox-sm mt-0.5"
        :checked="isGeminiPaidTierConfirmed"
        :disabled="pending"
        @change="onToggle"
      >
      <span class="grid gap-1">
        <span class="text-sm font-medium">
          {{ GOOGLE_DATA_PAID_TIER_STATEMENT }}
        </span>
        <span
          data-testid="gemini-paid-tier-note"
          class="text-xs opacity-70"
        >
          Unpaid Gemini API traffic may be used for training, with human
          review. Chats that hold data from Google Drive, Calendar or Gmail
          use Gemini only on a key you confirm here. Saving a new key clears
          this confirmation.
        </span>
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { GOOGLE_DATA_PAID_TIER_STATEMENT } from '#shared/utils/google-data-recipient'

const { isGeminiPaidTierConfirmed, refresh } = useUserKeys()

const pending = shallowRef<boolean>(false)

async function onToggle(event: Event) {
  const input = event.target as HTMLInputElement
  const confirmed = input.checked

  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/google/paid-tier', {
      method: 'POST',
      body: { confirmed },
    })
    await refresh()
    useSuccessMessage(confirmed
      ? 'Gemini paid tier confirmed'
      : 'Gemini paid tier confirmation removed')
  } catch (exception) {
    input.checked = !confirmed

    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save the confirmation',
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}
</script>
