<template>
  <UiBubble class="grow sm:w-md max-w-full">
    <div class="my-2 sm:my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold capitalize">
        Welcome back
      </h1>
      <p class="opacity-80">
        Sign in to your account to continue
      </p>
    </div>
    <ul class="grid gap-4 p-3">
      <li>
        <AuthLastUsedContainer>
          <Transition name="slide-fade">
            <LazyAuthLastUsedBadge v-if="lastLoginMethod === 'google'" />
          </Transition>
          <UiButton
            text="Sign in with Google"
            block
            :mode="lastLoginMethod === 'google' ? 'accent' : 'primary'"
            :disabled="pending || isSocialOAuthDisabled"
            @click="socialSignIn('google')"
          >
            <template #icon>
              <SvgoGoogle class="icon" />
            </template>
          </UiButton>
        </AuthLastUsedContainer>
      </li>
      <li>
        <AuthLastUsedContainer>
          <Transition name="slide-fade">
            <LazyAuthLastUsedBadge v-if="lastLoginMethod === 'github'" />
          </Transition>
          <UiButton
            text="Sign in with GitHub"
            block
            :mode="lastLoginMethod === 'github' ? 'accent' : 'primary'"
            :disabled="pending || isSocialOAuthDisabled"
            @click="socialSignIn('github')"
          >
            <template #icon>
              <SvgoGithub class="icon" />
            </template>
          </UiButton>
        </AuthLastUsedContainer>
      </li>
      <li>
        <UiButton
          text="Sign in with a passkey"
          block
          mode="primary"
          :disabled="pending"
          data-testid="signin-passkey"
          @click="signInWithPasskey"
        >
          <template #icon>
            <Icon name="lucide:fingerprint" size="20" />
          </template>
        </UiButton>
      </li>
    </ul>
    <LazyAuthInAppAlert v-if="displayEmbeddedBrowserWarning" />
    <div class="divider max-sm:my-2">or continue with</div>
    <UiForm
      class="w-full"
      @submit="onSubmit"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="data.email"
          autocomplete="email webauthn"
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
        <div class="flex items-center justify-between gap-2 sm:-mt-3">
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
        <AuthLastUsedContainer>
          <Transition name="slide-fade">
            <LazyAuthLastUsedBadge v-if="lastLoginMethod === 'email'" />
          </Transition>
          <UiButton
            type="submit"
            block
            :mode="lastLoginMethod === 'email' ? 'accent' : 'primary'"
            :text="pending ? 'Signing in...' : 'Sign in'"
            icon-name="lucide:log-in"
            :disabled="pending"
          />
        </AuthLastUsedContainer>
      </UiFormFieldset>
      <AuthTurnstile ref="turnstile" action="auth" />
    </UiForm>
    <p class="py-2 text-center">
      Don't have an account? <NuxtLink to="/signup" class="underline hover:no-underline">Sign up</NuxtLink>
    </p>
  </UiBubble>
</template>
<script setup lang="ts">
import UiForm from '~/components/ui/Form.vue'
import AuthTurnstile from '~/components/Auth/Turnstile.client.vue'

interface Data {
  email: string
  password: string
  rememberMe?: boolean
}

definePageMeta({
  layout: 'auth',
  auth: {
    only: 'guest',
  },
})

useSeoMeta({
  title: 'Sign In',
  robots: 'noindex, nofollow',
})

const { Validation } = useValidation()

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

const { signIn, errorCodes: _errorCodes, lastLoginMethod } = useAuth()

const turnstile = ref<InstanceType<typeof AuthTurnstile> | null>(null)
const pending = shallowRef<boolean>(false)

const isSocialOAuthDisabled = computed<boolean>(() => {
  if (!import.meta.client) {
    return false
  }

  return isLikelyEmbeddedBrowser()
})
const displayEmbeddedBrowserWarning = computed<boolean>(() => {
  return isSocialOAuthDisabled.value
})

onMounted(async () => {
  try {
    const supportsAutofill = await browserSupportsWebAuthnAutofill()

    if (!supportsAutofill) {
      return
    }

    await signIn.passkey({ autoFill: true })
  } catch {
    return
  }
})

async function socialSignIn(provider: 'google' | 'github') {
  pending.value = true

  try {
    await signInWithSocialOAuth(provider, '/chats/new')
  } finally {
    pending.value = false
  }
}

async function signInWithPasskey() {
  pending.value = true

  try {
    const { error } = await signIn.passkey()

    if (error) {
      const errorCode = 'code' in error ? error.code : undefined

      if (isPasskeyCeremonyCancelled(errorCode)) {
        return
      }

      useErrorMessage(error.message || 'Failed to sign in with passkey')

      return
    }

    useSuccessMessage('Successfully signed in')
  } finally {
    pending.value = false
  }
}

async function onSubmit() {
  pending.value = true

  const token = await turnstile.value?.execute()

  const { data: result, error } = await signIn.email({
    email: data.email,
    password: data.password,
    rememberMe: data.rememberMe,
    callbackURL: '/chats/new',
    fetchOptions: {
      headers: token ? { 'x-captcha-response': token } : {},
    },
  })

  if (error) {
    useErrorMessage(error.message)
    // if (error.code === errorCodes.EMAIL_NOT_VERIFIED) {
    //   useErrorMessage('Please verify your email before signing in.')
    // } else {
    //   useErrorMessage(error.message)
    // }
    turnstile.value?.reset()
    pending.value = false

    return
  }

  if (result && 'twoFactorRedirect' in result && result.twoFactorRedirect) {
    pending.value = false
    await navigateTo('/2fa')

    return
  }

  useSuccessMessage('Successfully signed in')
  pending.value = false
}
</script>
<style scoped>
  .slide-fade-enter-active {
    transition: all 0.3s ease-out;
  }

  .slide-fade-leave-active {
    transition: all 0.8s cubic-bezier(1, 0.5, 0.8, 1);
  }

  .slide-fade-enter-from,
  .slide-fade-leave-to {
    transform: translateY(5px);
    opacity: 0;
  }
</style>
