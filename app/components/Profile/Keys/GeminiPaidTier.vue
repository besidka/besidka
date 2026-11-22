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
        :checked="isChecked"
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
const savedConfirmation = shallowRef<boolean | null>(null)

const isChecked = computed<boolean>(() => {
  return savedConfirmation.value ?? isGeminiPaidTierConfirmed.value
})

watch(isGeminiPaidTierConfirmed, () => {
  savedConfirmation.value = null
})

async function refreshKeysQuietly() {
  try {
    await refresh()
  } catch {
    return
  }
}

async function onToggle(event: Event) {
  const input = event.target as HTMLInputElement
  const confirmed = input.checked

  pending.value = true

  try {
    const response = await $fetch('/api/v1/profiles/keys/google/paid-tier', {
      method: 'POST',
      body: { confirmed },
    })

    savedConfirmation.value = response.paidTierConfirmed
  } catch (exception) {
    input.checked = !confirmed
    pending.value = false

    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save the confirmation',
      parsedException.why,
    )

    return
  }

  useSuccessMessage(confirmed
    ? 'Gemini paid tier confirmed'
    : 'Gemini paid tier confirmation removed')

  await refreshKeysQuietly()

  pending.value = false
}
</script>
