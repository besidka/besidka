<template>
  <div
    v-if="isLoadingAccounts"
    class="skeleton skeleton--default h-16"
  />
  <div
    v-else-if="!hasCredentialAccount"
    role="alert"
    class="alert alert-soft alert-warning !items-start"
  >
    <Icon
      name="lucide:triangle-alert"
      size="20"
      class="mt-0.5 shrink-0"
    />
    <div class="grid gap-2">
      <p class="font-bold">No password on this account</p>
      <p class="text-sm">
        Two-factor authentication needs a password to protect. Sign out
        and use "Forgot password?" on the sign-in page to set one — that
        flow creates a password for your account.
      </p>
      <div>
        <UiButton
          text="Sign out"
          size="sm"
          mode="error"
          :disabled="pending"
          @click="signOutToSetPassword"
        />
      </div>
    </div>
  </div>
  <div
    v-else-if="isEnabling"
    class="grid gap-4"
  >
    <UiForm
      v-if="enableStep === 'password'"
      @submit="submitPassword"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="enablePassword"
          type="password"
          autocomplete="current-password"
          placeholder="Enter your account password"
          :rules="[Validation.required()]"
          :disabled="pending"
        />
      </UiFormFieldset>
      <UiFormFieldset
        :inputs="false"
        class="flex gap-2 justify-end mt-4"
      >
        <UiButton
          mode="neutral"
          ghost
          text="Cancel"
          :disabled="pending"
          @click="cancelEnable"
        />
        <UiButton
          type="submit"
          :text="pending ? 'Continuing...' : 'Continue'"
          :disabled="pending"
          data-testid="two-factor-password-continue"
        />
      </UiFormFieldset>
    </UiForm>
    <div
      v-else
      class="grid gap-4"
    >
      <div class="grid gap-2">
        <p class="text-sm text-base-content/70">
          Scan this code with your authenticator app (such as Google
          Authenticator or 1Password).
        </p>
        <div
          v-if="qrCodeSvg"
          class="w-40 h-40 mx-auto [&_svg]:w-full [&_svg]:h-full"
          data-testid="two-factor-qr-code"
          v-html="qrCodeSvg"
        />
        <p class="text-xs text-base-content/70">
          Can't scan? Enter this code manually:
        </p>
        <code
          class="block text-center break-all bg-base-200 rounded-box
            px-3 py-2 text-sm"
          data-testid="two-factor-manual-secret"
        >{{ manualSecret }}</code>
      </div>
      <UiForm @submit="submitVerify">
        <UiFormFieldset class="items-center">
          <UiFormOtp
            ref="setupOtpField"
            v-model="verifyCode"
            variant="totp"
            :disabled="pending"
            @complete="submitVerify"
          />
        </UiFormFieldset>
        <UiFormFieldset
          :inputs="false"
          class="flex gap-2 justify-end mt-4"
        >
          <UiButton
            mode="neutral"
            ghost
            text="Cancel"
            :disabled="pending"
            @click="cancelEnable"
          />
          <UiButton
            type="submit"
            :text="pending ? 'Verifying...' : 'Verify and turn on'"
            :disabled="pending || verifyCode.length < 6"
            data-testid="two-factor-verify-submit"
          />
        </UiFormFieldset>
      </UiForm>
    </div>
  </div>
  <div
    v-else-if="activeAction"
    class="grid gap-4"
  >
    <UiForm @submit="submitActionPassword">
      <UiFormFieldset>
        <UiFormInput
          v-model="actionPassword"
          type="password"
          autocomplete="current-password"
          placeholder="Enter your account password"
          :rules="[Validation.required()]"
          :disabled="pending"
        />
      </UiFormFieldset>
      <UiFormFieldset
        :inputs="false"
        class="flex gap-2 justify-end mt-4"
      >
        <UiButton
          mode="neutral"
          ghost
          text="Cancel"
          :disabled="pending"
          @click="cancelAction"
        />
        <UiButton
          type="submit"
          :text="pending ? 'Confirming...' : 'Confirm'"
          :disabled="pending"
          data-testid="two-factor-action-confirm"
        />
      </UiFormFieldset>
    </UiForm>
  </div>
  <div
    v-else-if="twoFactorEnabled"
    class="flex flex-wrap items-center justify-between gap-4"
  >
    <div>
      <p class="font-medium">Enabled</p>
      <p class="text-sm text-base-content/70">
        Your account requires a code from your authenticator app when
        signing in with your password. Signing in with a passkey or a
        linked account skips this step.
      </p>
    </div>
    <div class="flex gap-2">
      <UiButton
        text="Regenerate backup codes"
        size="sm"
        outline
        :disabled="pending"
        data-testid="two-factor-regenerate"
        @click="regenerateCodes"
      />
      <UiButton
        text="Turn off"
        mode="error"
        outline
        size="sm"
        :disabled="pending"
        data-testid="two-factor-turn-off"
        @click="turnOff"
      />
    </div>
  </div>
  <div
    v-else
    class="flex flex-wrap items-center justify-between gap-4"
  >
    <p class="text-sm text-base-content/70">
      Add a second sign-in step using an authenticator app.
    </p>
    <UiButton
      text="Enable"
      size="sm"
      data-testid="two-factor-enable"
      @click="startEnable"
    />
  </div>

  <ProfileSecurityBackupCodes
    :open="showBackupCodesModal"
    :codes="backupCodes"
    @acknowledge="acknowledgeBackupCodes"
  />
</template>

<script setup lang="ts">
import UiFormOtp from '~/components/ui/Form/Otp.vue'
import { encodeQrCode, qrMatrixToSvg } from '~/utils/qr-code'

type EnableStep = 'password' | 'setup'
type PasswordGatedAction = 'disable' | 'regenerate'

const { Validation } = useValidation()
const { client, user, errorCodes, fetchSession, signOut } = useAuth()

const {
  isLoadingInitial: isLoadingAccounts,
  hasCredentialAccount,
  fetchLinkedAccounts,
} = useLinkedAccounts()

const setupOtpField = ref<InstanceType<typeof UiFormOtp> | null>(null)

const pending = shallowRef<boolean>(false)

const isEnabling = shallowRef<boolean>(false)
const enableStep = shallowRef<EnableStep>('password')
const enablePassword = shallowRef<string>('')
const totpURI = shallowRef<string>('')
const verifyCode = shallowRef<string>('')

const activeAction = shallowRef<PasswordGatedAction | null>(null)
const actionPassword = shallowRef<string>('')

const backupCodes = shallowRef<string[]>([])
const showBackupCodesModal = shallowRef<boolean>(false)

const twoFactorEnabled = computed<boolean>(() => {
  return !!user.value?.twoFactorEnabled
})

const manualSecret = computed<string>(() => {
  const match = totpURI.value.match(/[?&]secret=([^&]+)/)

  return match?.[1] ? decodeURIComponent(match[1]) : ''
})

const qrCodeSvg = computed<string>(() => {
  if (!totpURI.value) {
    return ''
  }

  try {
    return qrMatrixToSvg(encodeQrCode(totpURI.value))
  } catch {
    return ''
  }
})

onMounted(async () => {
  await fetchLinkedAccounts()
})

async function signOutToSetPassword() {
  await signOut({
    redirectTo: '/signin',
  })
}

function startEnable() {
  isEnabling.value = true
  enableStep.value = 'password'
  enablePassword.value = ''
}

function cancelEnable() {
  isEnabling.value = false
  enableStep.value = 'password'
  enablePassword.value = ''
  totpURI.value = ''
  verifyCode.value = ''
  backupCodes.value = []
}

function cancelAction() {
  activeAction.value = null
  actionPassword.value = ''
}

async function submitPassword() {
  pending.value = true

  const { data, error } = await client.twoFactor.enable({
    password: enablePassword.value,
  })

  if (error) {
    if (error.code === errorCodes.INVALID_PASSWORD?.code) {
      useErrorMessage('Your account password is incorrect')
    } else {
      useErrorMessage(error.message || 'Failed to start setup')
    }

    pending.value = false

    return
  }

  totpURI.value = data.totpURI
  backupCodes.value = data.backupCodes
  verifyCode.value = ''
  enableStep.value = 'setup'
  pending.value = false

  await nextTick()
  setupOtpField.value?.focus()
}

async function submitVerify() {
  if (pending.value || verifyCode.value.length < 6) {
    return
  }

  pending.value = true

  const { error } = await client.twoFactor.verifyTotp({
    code: verifyCode.value,
  })

  if (error) {
    if (error.code === errorCodes.INVALID_CODE?.code) {
      useErrorMessage(
        'Wrong code',
        'Check your authenticator app and try again.',
      )
    } else {
      useErrorMessage(error.message || 'Failed to verify the code')
    }

    verifyCode.value = ''
    pending.value = false

    return
  }

  await fetchSession()

  isEnabling.value = false
  enableStep.value = 'password'
  totpURI.value = ''
  verifyCode.value = ''
  showBackupCodesModal.value = true
  pending.value = false
}

async function turnOff() {
  const confirmed = await useConfirm({
    text: 'Turn off two-factor authentication?',
    subtitle: 'You will only need your password to sign in from now on.',
    alert: true,
    actions: ['Turn off'],
    labelDecline: 'Cancel',
  })

  if (!confirmed) {
    return
  }

  activeAction.value = 'disable'
  actionPassword.value = ''
}

async function regenerateCodes() {
  const confirmed = await useConfirm({
    text: 'Regenerate backup codes?',
    subtitle: 'Your existing backup codes will stop working immediately.',
    alert: true,
    actions: ['Regenerate'],
    labelDecline: 'Cancel',
  })

  if (!confirmed) {
    return
  }

  activeAction.value = 'regenerate'
  actionPassword.value = ''
}

async function submitDisable() {
  const { error } = await client.twoFactor.disable({
    password: actionPassword.value,
  })

  if (error) {
    if (error.code === errorCodes.INVALID_PASSWORD?.code) {
      useErrorMessage('Your account password is incorrect')
    } else {
      useErrorMessage(
        error.message || 'Failed to turn off two-factor authentication',
      )
    }

    return
  }

  await fetchSession()

  activeAction.value = null
  actionPassword.value = ''
  useSuccessMessage('Two-factor authentication turned off')
}

async function submitRegenerate() {
  const { data, error } = await client.twoFactor.generateBackupCodes({
    password: actionPassword.value,
  })

  if (error) {
    if (error.code === errorCodes.INVALID_PASSWORD?.code) {
      useErrorMessage('Your account password is incorrect')
    } else {
      useErrorMessage(error.message || 'Failed to regenerate backup codes')
    }

    return
  }

  backupCodes.value = data.backupCodes
  activeAction.value = null
  actionPassword.value = ''
  showBackupCodesModal.value = true

  await fetchSession()
}

async function submitActionPassword() {
  if (!activeAction.value) {
    return
  }

  pending.value = true

  if (activeAction.value === 'disable') {
    await submitDisable()
  } else {
    await submitRegenerate()
  }

  pending.value = false
}

function acknowledgeBackupCodes() {
  showBackupCodesModal.value = false
  backupCodes.value = []
}
</script>
