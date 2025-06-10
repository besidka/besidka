<template>
  <UiBubble class="grow sm:w-md max-w-full">
    <div class="my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold capitalize">
        Forgot password?
      </h1>
      <p class="opacity-80">
        Enter your email and we'll send you reset instructions
      </p>
    </div>
    <UiForm
      ref="form"
      class="w-full"
      @submit="onSubmit"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="data.email"
          autocomplete="email"
          type="email"
          placeholder="example@example.com"
          :rules="[Validation.required(), Validation.email()]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              name="lucide:at-sign"
              size="16"
            />
          </template>
        </UiFormInput>
      </UiFormFieldset>
      <UiFormFieldset class="flex justify-center mt-4">
        <UiButton
          type="submit"
          :text="pending ? 'Sending...' : 'Send reset instructions'"
          icon-name="lucide:mail"
          class="w-full"
          :disabled="pending"
        />
      </UiFormFieldset>
    </UiForm>
    <p class="flex items-center justify-center gap-2 py-2 text-center">
      <Icon
        name="lucide:arrow-left"
        size="16"
      />
      <NuxtLink to="/signin" class="underline hover:no-underline">Back to Sign in</NuxtLink>
    </p>
  </UiBubble>
</template>
<script setup lang="ts">
import UiForm from '~/components/ui/Form.vue'

interface Data {
  email: string
}

definePageMeta({
  middleware: 'guest',
  layout: 'auth',
})

useSeoMeta({
  title: 'Reset Password',
})

const { Validation } = useValidation()

const form = ref<InstanceType<typeof UiForm> | null>()

const data = shallowReactive<Data>({
  email: '',
})

const pending = shallowRef<boolean>(false)

async function onSubmit() {
  try {
    pending.value = true

    await $fetch('/api/v1/auth/reset-password', {
      method: 'post',
      body: data,
    })

    useSuccessMessage(
      'If an account with that email exists, we have sent you reset instructions. Please check your inbox.',
    )
    await navigateTo('/signin')
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  } finally {
    pending.value = false
  }
}
</script>
