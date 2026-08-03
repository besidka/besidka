<template>
  <h1 class="mb-8 text-4xl font-bold text-center">Password</h1>
  <UiBubble>
    <div
      v-if="!isLoadingAccounts && !hasCredentialAccount"
      role="alert"
      class="alert alert-soft alert-warning !items-start"
    >
      <Icon name="lucide:triangle-alert" size="20" class="mt-0.5 shrink-0" />
      <div class="grid gap-2">
        <p class="font-bold">No password on this account</p>
        <p class="text-sm">
          Your account signs in with Google or GitHub only, so there's no
          password to change. Sign out and use "Forgot password?" on the
          sign-in page to set one — that flow creates a password for your
          account.
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
    <LazyUiForm
      v-else-if="!isLoadingAccounts"
      ref="form"
      class="w-full"
      @submit="onSubmit"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="data.currentPassword"
          autocomplete="current-password"
          :type="currentPasswordVisibility.type.value"
          placeholder="Enter your current password"
          :rules="[Validation.required()]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              :name="currentPasswordVisibility.labelIcon.value"
              size="16"
            />
          </template>
          <template #labelAfter>
            <span
              :class="{
                'tooltip tooltip-right': data.currentPassword.length,
              }"
              :data-tip="currentPasswordVisibility.revealTip.value"
            >
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm"
                :disabled="!data.currentPassword.length"
                @click="currentPasswordVisibility.toggle"
              >
                <Icon
                  :name="currentPasswordVisibility.revealIcon.value"
                  size="16"
                />
                <span class="sr-only">
                  {{ currentPasswordVisibility.revealTip.value }}
                </span>
              </button>
            </span>
          </template>
        </UiFormInput>
        <UiFormInput
          v-model="data.newPassword"
          autocomplete="new-password"
          :type="newPasswordVisibility.type.value"
          placeholder="Enter your new password"
          :rules="passwordRules"
          :disabled="pending"
          @focus.once="isNewPasswordFocused = true"
          @change="updateRulesStatus"
        >
          <template #labelBefore>
            <Icon
              :name="newPasswordVisibility.labelIcon.value"
              size="16"
            />
          </template>
          <template #labelAfter>
            <span
              :class="{
                'tooltip tooltip-right': data.newPassword.length,
              }"
              :data-tip="newPasswordVisibility.revealTip.value"
            >
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm"
                :disabled="!data.newPassword.length"
                @click="newPasswordVisibility.toggle"
              >
                <Icon
                  :name="newPasswordVisibility.revealIcon.value"
                  size="16"
                />
                <span class="sr-only">
                  {{ newPasswordVisibility.revealTip.value }}
                </span>
              </button>
            </span>
          </template>
        </UiFormInput>
        <Transition
          appear
          name="rules"
          :duration="500"
        >
          <UiBubble
            v-if="isNewPasswordFocused"
            class="relative overflow-hidden p-4 shadow-md text-xs bg-gradient-to-br from-base-100"
            :class="{
              'to-base-200': !data.newPassword,
              'to-error/30': data.newPassword && !allPasswordRulesPassed,
              'to-success/50 animate-pulse-once':
                data.newPassword && allPasswordRulesPassed,
            }"
          >
            <ul>
              <li
                v-for="({ message, passed }, index) in passwordRules"
                :key="index"
                class="relative z-20 flex mb-1"
              >
                <Icon
                  :name="`${passed ? 'lucide:check' : 'lucide:x'}`"
                  size="16"
                  class="mr-1"
                  :class="{
                    'text-success': passed,
                    'text-error': !passed,
                  }"
                />
                <span>{{ message }}</span>
              </li>
            </ul>
            <div
              class="flex items-center mt-4 *:ml-2 *:py-1 *:px-2 *:rounded-full *:bg-gradient-to-br *:drop-shadow"
              :class="timeToCrackHighlight"
            >
              Time to crack:
              <strong
                class="badge text-xs"
                :class="timeToCrackHighlight"
              >{{ timeToCrack }}</strong>
            </div>
          </UiBubble>
        </Transition>
        <UiFormInput
          v-model="data.newPasswordConfirmation"
          autocomplete="new-password"
          :type="confirmPasswordVisibility.type.value"
          placeholder="Confirm your new password"
          :rules="[Validation.required(), Validation.equal(data.newPassword)]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              name="lucide:shield-check"
              size="16"
            />
          </template>
          <template #labelAfter>
            <span
              :class="{
                'tooltip tooltip-right': data.newPasswordConfirmation.length,
              }"
              :data-tip="confirmPasswordVisibility.revealTip.value"
            >
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm"
                :disabled="!data.newPasswordConfirmation.length"
                @click="confirmPasswordVisibility.toggle"
              >
                <Icon
                  :name="confirmPasswordVisibility.revealIcon.value"
                  size="16"
                />
                <span class="sr-only">
                  {{ confirmPasswordVisibility.revealTip.value }}
                </span>
              </button>
            </span>
          </template>
        </UiFormInput>
        <UiFormCheckbox
          v-model="data.revokeOtherSessions"
          :disabled="pending"
        >
          Sign out on all other devices
        </UiFormCheckbox>
      </UiFormFieldset>
      <UiFormFieldset :inputs="false" class="flex justify-center mt-4">
        <UiButton
          type="submit"
          :text="pending ? 'Updating...' : 'Update password'"
          icon-name="lucide:key"
          :disabled="pending"
          data-testid="password-submit"
        />
      </UiFormFieldset>
    </LazyUiForm>
  </UiBubble>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import type { ValidationRule } from '~/types/validation.d'
import type { EstimateCrack } from '~/types/password'
import { TimeUnits } from '~/types/password'
import UiForm from '~/components/ui/Form.vue'

interface Data {
  currentPassword: string
  newPassword: string
  newPasswordConfirmation: string
  revokeOtherSessions: boolean
}

interface Rule extends ValidationRule {
  passed: boolean
}

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Password',
  robots: 'noindex, nofollow',
})

function createPasswordVisibility() {
  const display = shallowRef<boolean>(false)

  const type = computed<'password' | 'text'>(() => {
    return display.value ? 'text' : 'password'
  })
  const labelIcon = computed<
    'lucide:lock-keyhole' | 'lucide:lock-keyhole-open'
  >(() => {
    return display.value ? 'lucide:lock-keyhole-open' : 'lucide:lock-keyhole'
  })
  const revealIcon = computed<'lucide:eye' | 'lucide:eye-closed'>(() => {
    return display.value ? 'lucide:eye-closed' : 'lucide:eye'
  })
  const revealTip = computed<string>(() => {
    return display.value ? 'Hide password' : 'Show password'
  })

  const toggle = () => {
    display.value = !display.value
  }

  return { display, type, labelIcon, revealIcon, revealTip, toggle }
}

const { Validation } = useValidation()
const { estimateTimeToCrack } = usePassword()
const $auth = useAuth()
const { errorCodes } = $auth

const {
  isLoadingInitial: isLoadingAccounts,
  hasCredentialAccount,
  fetchLinkedAccounts,
} = useLinkedAccounts()

const form = ref<InstanceType<typeof UiForm> | null>()
const isNewPasswordFocused = shallowRef<boolean>(false)
const pending = shallowRef<boolean>(false)

const currentPasswordVisibility = createPasswordVisibility()
const newPasswordVisibility = createPasswordVisibility()
const confirmPasswordVisibility = createPasswordVisibility()

const data = shallowReactive<Data>({
  currentPassword: '',
  newPassword: '',
  newPasswordConfirmation: '',
  revokeOtherSessions: true,
})

const formatPasswordRule = (rule: ValidationRule): Rule => ({
  ...rule,
  passed: rule.validate(data.newPassword),
})

const passwordRules = reactive<Rule[]>(
  [
    Validation.min(8),
    Validation.digit(),
    Validation.uppercase(),
    Validation.specialChar(),
  ].map(formatPasswordRule),
)

const updateRulesStatus = () => {
  for (const rule of passwordRules) {
    rule.passed = rule.validate(data.newPassword)
  }
}

const allPasswordRulesPassed = computed<boolean>(() => {
  return passwordRules.every(rule => rule.passed)
})

const estimate = computed<EstimateCrack>(() => {
  return estimateTimeToCrack(data.newPassword)
})

const timeToCrack = computed<string>(() => estimate.value.text)

const timeToCrackHighlight = computed(() => {
  const { unit } = estimate.value

  return {
    'badge-error': [TimeUnits.seconds, TimeUnits.minutes].includes(unit),
    'badge-warning': unit === TimeUnits.hours,
    'badge-info': unit === TimeUnits.days,
    'badge-success': unit === TimeUnits.years,
  }
})

onMounted(async () => {
  await fetchLinkedAccounts()
})

async function signOutToSetPassword() {
  await $auth.signOut({
    redirectTo: '/signin',
  })
}

async function onSubmit() {
  pending.value = true

  try {
    const { error } = await $auth.client.changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      revokeOtherSessions: data.revokeOtherSessions,
    })

    if (error) {
      if (error.code === errorCodes.INVALID_PASSWORD?.code) {
        useErrorMessage('Your current password is incorrect')
      } else {
        useErrorMessage(error.message || 'Failed to update password.')
      }

      return
    }

    useSuccessMessage('Password updated')
    data.currentPassword = ''
    data.newPassword = ''
    data.newPasswordConfirmation = ''
    isNewPasswordFocused.value = false
    await form.value?.resetValidation()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to update password.',
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}
</script>
