<template>
  <UiBubble class="grow sm:w-md max-w-full">
    <div class="my-2 sm:my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold">
        Two-factor authentication
      </h1>
      <p class="opacity-80">
        {{ useBackupCode
          ? 'Enter one of your backup codes'
          : 'Enter the 6-digit code from your authenticator app' }}
      </p>
    </div>
    <UiForm
      class="w-full"
      @submit="handleSubmit"
    >
      <UiFormFieldset class="flex flex-col items-center gap-4">
        <UiFormOtp
          ref="otpField"
          v-model="code"
          :variant="useBackupCode ? 'backup-code' : 'totp'"
          :disabled="pending"
          data-testid="two-factor-code"
          @complete="onOtpComplete"
        />
        <UiFormCheckbox
          v-model="trustDevice"
          :disabled="pending"
        >
          Trust this device for 30 days
        </UiFormCheckbox>
      </UiFormFieldset>
      <UiFormFieldset
        :inputs="false"
        class="flex justify-center mt-4"
      >
        <UiButton
          type="submit"
          :text="pending ? 'Verifying...' : 'Verify'"
          icon-name="lucide:shield-check"
          :disabled="pending || code.length < requiredLength"
          data-testid="two-factor-submit"
        />
      </UiFormFieldset>
    </UiForm>
    <p class="py-2 text-center">
      <button
        type="button"
        class="underline hover:no-underline"
        data-testid="two-factor-toggle-backup-code"
        @click="toggleBackupCode"
      >
        {{ useBackupCode
          ? 'Use an authenticator code instead'
          : 'Use a backup code instead' }}
      </button>
    </p>
  </UiBubble>
</template>

<script setup lang="ts">
import UiForm from '~/components/ui/Form.vue'
import UiFormOtp from '~/components/ui/Form/Otp.vue'

definePageMeta({
  layout: 'auth',
  auth: {
    only: 'guest',
  },
})

useSeoMeta({
  title: 'Two-factor authentication',
  robots: 'noindex, nofollow',
})

const { client, errorCodes, options, fetchSession } = useAuth()

const otpField = ref<InstanceType<typeof UiFormOtp> | null>(null)

const code = shallowRef<string>('')
const trustDevice = shallowRef<boolean>(false)
const useBackupCode = shallowRef<boolean>(false)
const pending = shallowRef<boolean>(false)

const requiredLength = computed<number>(() => {
  return useBackupCode.value ? 11 : 6
})

async function toggleBackupCode() {
  useBackupCode.value = !useBackupCode.value
  code.value = ''

  await nextTick()
  otpField.value?.focus()
}

async function resetCode() {
  code.value = ''
  await nextTick()
  otpField.value?.focus()
}

async function handleVerifyError(error: { code?: string, message?: string }) {
  if (error.code === errorCodes.INVALID_CODE?.code) {
    useErrorMessage(
      'Wrong code',
      'Check your authenticator app and try again.',
    )
    await resetCode()

    return
  }

  if (error.code === errorCodes.INVALID_BACKUP_CODE?.code) {
    useErrorMessage(
      'Invalid backup code',
      'That code is wrong or has already been used.',
    )
    await resetCode()

    return
  }

  if (error.code === errorCodes.ACCOUNT_TEMPORARILY_LOCKED?.code) {
    useErrorMessage(
      'Too many failed attempts',
      'Your account is temporarily locked. Please wait a while '
      + 'before trying again.',
    )
    await resetCode()

    return
  }

  if (
    error.code === errorCodes.TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE?.code
    || error.code === errorCodes.INVALID_TWO_FACTOR_COOKIE?.code
  ) {
    useErrorMessage(
      'Sign-in attempt timed out',
      'Please sign in again to start a new verification.',
    )
    await navigateTo('/signin')

    return
  }

  useErrorMessage(error.message || 'Verification failed')
  await resetCode()
}

async function verify() {
  if (pending.value || code.value.length < requiredLength.value) {
    return
  }

  pending.value = true

  const verifyMethod = useBackupCode.value
    ? client.twoFactor.verifyBackupCode
    : client.twoFactor.verifyTotp

  const { error } = await verifyMethod({
    code: code.value,
    trustDevice: trustDevice.value,
  })

  if (error) {
    await handleVerifyError(error)
    pending.value = false

    return
  }

  await fetchSession()
  await navigateTo(options.redirectUserTo)

  pending.value = false
}

async function onOtpComplete() {
  await verify()
}

async function handleSubmit() {
  if (code.value.length < requiredLength.value) {
    useErrorMessage('Enter the complete code')

    return
  }

  await verify()
}
</script>
