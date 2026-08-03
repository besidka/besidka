<template>
  <h1 class="mb-2 text-4xl font-bold text-center">
    Change your email address
  </h1>
  <p class="mb-8 text-sm text-base-content/70 text-center">
    We'll send a confirmation link to your current email address
    to verify this change before it takes effect.
  </p>
  <UiBubble>
    <div
      v-if="!isCurrentEmailVerified"
      role="alert"
      class="alert alert-soft alert-warning !items-start"
    >
      <Icon name="lucide:triangle-alert" size="20" class="mt-0.5 shrink-0" />
      <div class="grid gap-2">
        <p class="font-bold">Verify your current email first</p>
        <p class="text-sm">
          {{ currentEmail }} isn't verified yet. We can only confirm an
          email change through an already-verified current address, so
          verify it before changing it.
        </p>
        <div>
          <UiButton
            text="Resend verification email"
            size="sm"
            :disabled="isResending"
            data-testid="email-resend-verification"
            @click="resendVerification"
          />
        </div>
      </div>
    </div>
    <template v-else>
      <UiForm class="w-full" @submit="onSubmit">
        <UiFormFieldset>
          <UiFormInput
            v-model="data.newEmail"
            autocomplete="email"
            type="email"
            placeholder="new@example.com"
            :rules="rules"
            :disabled="pending"
          >
            <template #labelBefore>
              <Icon name="lucide:at-sign" size="16" />
            </template>
          </UiFormInput>
        </UiFormFieldset>
        <UiFormFieldset
          :inputs="false"
          class="!flex flex-col sm:items-center mt-4"
        >
          <UiButton
            type="submit"
            :text="pending ? 'Sending...' : 'Send confirmation link'"
            icon-name="lucide:mail"
            :disabled="pending"
            class="max-sm:btn-block sm:btn-wide sm:w-64"
            data-testid="email-submit"
          />
        </UiFormFieldset>
      </UiForm>
    </template>
  </UiBubble>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import type { ValidationRule } from '~/types/validation.d'
import UiForm from '~/components/ui/Form.vue'

interface Data {
  newEmail: string
}

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Email address',
  robots: 'noindex, nofollow',
})

const { Validation } = useValidation()
const $auth = useAuth()
const { user } = $auth

const currentEmail = computed<string>(() => user.value?.email ?? '')
const isCurrentEmailVerified = computed<boolean>(() => {
  return !!user.value?.emailVerified
})

const data = shallowReactive<Data>({
  newEmail: '',
})

const rules = computed<ValidationRule[]>(() => [
  Validation.required(),
  Validation.email(),
  {
    validate: (value) => {
      return value.toString().trim().toLowerCase()
        !== currentEmail.value.toLowerCase()
    },
    message: 'This is already your current email address',
  },
])

const pending = shallowRef<boolean>(false)
const isResending = shallowRef<boolean>(false)

async function onSubmit() {
  pending.value = true

  try {
    const { error } = await $auth.client.changeEmail({
      newEmail: data.newEmail,
      callbackURL: '/profile/security',
    })

    if (error) {
      useErrorMessage(error.message || 'Failed to request email change.')

      return
    }

    useInfoMessage(
      'Check your current email',
      'If that address is available, we\'ve sent a confirmation link to '
      + 'your current email address. Open it to continue.',
    )
    data.newEmail = ''
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to request email change.',
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}

async function resendVerification() {
  isResending.value = true

  try {
    const { error } = await $auth.client.sendVerificationEmail({
      email: currentEmail.value,
      callbackURL: '/profile/email',
    })

    if (error) {
      useErrorMessage(
        error.message || 'Failed to resend verification email.',
      )

      return
    }

    useSuccessMessage('Verification email sent')
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
