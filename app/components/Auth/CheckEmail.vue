<template>
  <div
    class="grid gap-4 p-3 text-center"
    data-testid="check-email"
  >
    <div class="flex justify-center">
      <span
        class="grid place-items-center size-14 rounded-full bg-success/15 text-success"
      >
        <Icon
          name="lucide:mail-check"
          size="28"
        />
      </span>
    </div>
    <h2 class="text-2xl font-bold">
      Check your email
    </h2>
    <p>
      We sent a verification link to
      <strong
        class="break-all"
        data-testid="check-email-address"
      >{{ email }}</strong>.
      Open it to activate your account.
    </p>
    <p class="text-sm opacity-80">
      Nothing there after a minute? Check your spam folder, or send the link
      again.
    </p>
    <div class="grid gap-2 justify-items-center">
      <UiButton
        :text="resendText"
        icon-name="lucide:send"
        :disabled="isResendDisabled"
        data-testid="check-email-resend"
        @click="resend"
      />
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="check-email-change"
        @click="emit('change-email')"
      >
        Use a different address
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

const RESEND_COOLDOWN_SECONDS = 60

const props = defineProps<{
  email: string
  callbackUrl: string
}>()

const emit = defineEmits<{
  'change-email': []
}>()

const { client } = useAuth()

const isResending = shallowRef<boolean>(false)
const cooldownSeconds = shallowRef<number>(RESEND_COOLDOWN_SECONDS)

const { pause, resume } = useIntervalFn(() => {
  cooldownSeconds.value -= 1

  if (cooldownSeconds.value <= 0) {
    pause()
  }
}, 1000, { immediate: false })

const isResendDisabled = computed<boolean>(() => {
  return isResending.value || cooldownSeconds.value > 0
})

const resendText = computed<string>(() => {
  if (isResending.value) {
    return 'Sending...'
  }

  if (cooldownSeconds.value > 0) {
    return `Resend in ${cooldownSeconds.value}s`
  }

  return 'Resend verification email'
})

function startCooldown() {
  cooldownSeconds.value = RESEND_COOLDOWN_SECONDS
  resume()
}

onMounted(startCooldown)

async function resend() {
  if (isResendDisabled.value) {
    return
  }

  isResending.value = true

  try {
    const { error } = await client.sendVerificationEmail({
      email: props.email,
      callbackURL: props.callbackUrl,
    })

    if (error) {
      useErrorMessage(
        error.message || 'Failed to resend verification email.',
      )

      return
    }

    useSuccessMessage('Verification email sent')
    startCooldown()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to resend verification email.',
      parsedException.why,
    )
  } finally {
    isResending.value = false
  }
}
</script>
