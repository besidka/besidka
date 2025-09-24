<template>
  <UiBubble class="grow sm:w-md max-w-full">
    <div class="my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold capitalize">
        Welcome back
      </h1>
      <p class="opacity-80">
        Sign in to your account to continue
      </p>
    </div>
    <ul class="grid gap-4 p-3">
      <li>
        <UiButton
          text="Sign in with Google"
          class="w-full"
          :disabled="pending"
          @click="socialSignIn('google')"
        >
          <template #icon>
            <SvgoGoogle class="icon" />
          </template>
        </UiButton>
      </li>
      <li>
        <UiButton
          text="Sign in with GitHub"
          class="w-full"
          :disabled="pending"
          @click="socialSignIn('github')"
        >
          <template #icon>
            <SvgoGithub class="icon" />
          </template>
        </UiButton>
      </li>
    </ul>
    <div class="divider">or continue with</div>
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
        <UiFormInput
          v-model="data.password"
          autocomplete="current-password"
          :type="type"
          placeholder="Enter your password"
          :rules="[Validation.required()]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              :name="labelIcon"
              size="16"
            />
          </template>
          <template #labelAfter>
            <span
              :class="{
                'tooltip tooltip-right': data.password.length,
              }"
              :data-tip="revealTip"
            >
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm"
                :disabled="!data.password.length"
                @click="displayPassword = !displayPassword"
              >
                <Icon
                  :name="revealIcon"
                  size="16"
                />
                <span class="sr-only">{{ revealTip }}</span>
              </button>
            </span>
          </template>
        </UiFormInput>
        <div class="flex items-center justify-between gap-2 -mt-3">
          <UiFormCheckbox
            v-model="data.rememberMe"
            :disabled="pending"
          >
            Remember me
          </UiFormCheckbox>
          <NuxtLink
            to="/reset-password"
            class="text-sm underline hover:no-underline"
          >
            Forgot password?
          </NuxtLink>
        </div>
      </UiFormFieldset>
      <UiFormFieldset class="flex justify-center mt-4">
        <UiButton
          type="submit"
          :text="pending ? 'Signing in...' : 'Sign in'"
          icon-name="lucide:log-in"
          class="w-full"
          :disabled="pending"
        />
      </UiFormFieldset>
    </UiForm>
    <p class="py-2 text-center">
      Don't have an account? <NuxtLink to="/signup" class="underline hover:no-underline">Sign up</NuxtLink>
    </p>
  </UiBubble>
</template>
<script setup lang="ts">
import UiForm from '~/components/ui/Form.vue'

interface Data {
  email: string
  password: string
  rememberMe?: boolean
}

definePageMeta({
  middleware: 'guest',
  layout: 'auth',
})

useSeoMeta({
  title: 'Sign In',
})

const { Validation } = useValidation()

const form = ref<InstanceType<typeof UiForm> | null>()
const displayPassword = shallowRef<boolean>(false)

const type = computed<'password' | 'text'>(() => {
  return displayPassword.value ? 'text' : 'password'
})
const labelIcon = computed<
  'lucide:lock-keyhole' | 'lucide:lock-keyhole-open'
>(() => {
  return displayPassword.value
    ? 'lucide:lock-keyhole-open'
    : 'lucide:lock-keyhole'
})
const revealIcon = computed<
  'lucide:eye' | 'lucide:eye-closed'
>(() => {
  return displayPassword.value
    ? 'lucide:eye-closed'
    : 'lucide:eye'
})
const revealTip = computed(() => {
  return displayPassword.value ? 'Hide password' : 'Show password'
})

const data = shallowReactive<Data>({
  email: '',
  password: '',
  rememberMe: true,
})

const { signIn } = useAuth()

const pending = shallowRef<boolean>(false)

async function socialSignIn(provider: 'google' | 'github') {
  pending.value = true

  try {
    await signIn.social({
      provider,
      callbackURL: '/chats/new',
      fetchOptions: {
        onSuccess() {
          useSuccessMessage(`Successfully signed in with ${provider}`)
        },
      },
    })
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  } finally {
    pending.value = false
  }
}

async function onSubmit() {
  pending.value = true

  try {
    await signIn.email({
      email: data.email,
      password: data.password,
      rememberMe: data.rememberMe,
      callbackURL: '/chats/new',
      fetchOptions: {
        onSuccess() {
          useSuccessMessage('Successfully signed in')
        },
      },
    })
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  } finally {
    pending.value = false
  }
}
</script>
