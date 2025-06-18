<template>
  <UiBubble class="grow w-full min-sm:max-w-md z-20">
    <div class="my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold capitalize">
        Create account
      </h1>
      <p class="opacity-80">
        Start your journey with us today
      </p>
    </div>
    <ul class="grid gap-4 p-3">
      <li>
        <UiButton
          text="Sign up with Google"
          icon-name="mdi:google"
          class="w-full"
          :disabled="pending"
          @click="socialSignIn('google')"
        />
      </li>
      <li>
        <UiButton
          text="Sign up with GitHub"
          icon-name="mdi:github"
          class="w-full"
          :disabled="pending"
          @click="socialSignIn('github')"
        />
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
          v-model="data.name"
          autocomplete="name"
          placeholder="John Doe"
          :rules="[
            Validation.required(),
            Validation.min(),
            Validation.withoutDigits()
          ]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              name="lucide:user"
              size="16"
            />
          </template>
        </UiFormInput>
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
          autocomplete="new-password"
          :type="type"
          placeholder="Enter your password"
          :rules="rules"
          :disabled="pending"
          @focus.once="isFocused = true"
          @change="updateRulesStatus"
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
        <Transition
          appear
          name="rules"
          :duration="500"
        >
          <UiBubble
            v-if="isFocused"
            class="relative overflow-hidden p-4 shadow-md text-xs bg-gradient-to-br from-base-100"
            :class="{
              'to-error/10': !data.password || data.password && !allRulesPassed,
              'to-success/50 animate-pulse-once':
                data.password && allRulesPassed,
            }"
          >
            <ul>
              <li
                v-for="({ message, passed }, index) in rules"
                :key="index"
                class="relative z-20 flex mb-1"
              >
                <Icon
                  :name="
                    `${passed ? 'lucide:check' : 'lucide:x'}`
                  "
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
              <strong class="badge badge-soft text-xs" :class="timeToCrackHighlight">
                {{ timeToCrack }}
              </strong>
            </div>
          </UiBubble>
        </Transition>
        <UiFormInput
          v-model="data.passwordConfirmation"
          autocomplete="new-password"
          :type="typeConfirmation"
          placeholder="Confirm your password"
          :rules="[Validation.required(), Validation.equal(data.password)]"
          :disabled="pending"
          @focus.once="isFocused = true"
          @change="updateRulesStatus"
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
                'tooltip tooltip-right': data.passwordConfirmation.length,
              }"
              :data-tip="revealTipConfirmation"
            >
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm"
                :disabled="!data.passwordConfirmation.length"
                @click="
                  displayPasswordConfirmation = !displayPasswordConfirmation
                "
              >
                <Icon
                  :name="revealIconConfirmation"
                  size="16"
                />
                <span class="sr-only">{{ revealTipConfirmation }}</span>
              </button>
            </span>
          </template>
        </UiFormInput>
        <UiFormCheckbox
          v-model="data.agreeToTerms"
          :rules="[Validation.required()]"
          :disabled="pending"
          class="-mt-3"
        >
          Agree to the <NuxtLink to="/terms" class="underline hover:no-underline">Terms of Service</NuxtLink> and <NuxtLink to="/privacy" class="underline hover:no-underline">Privacy Policy</NuxtLink>
        </UiFormCheckbox>
      </UiFormFieldset>
      <UiFormFieldset :inputs="false" class="flex justify-center mt-4">
        <UiButton
          type="submit"
          :text="pending ? 'Signing up...' : 'Sign up'"
          icon-name="lucide:user-plus"
          class="w-full"
          :disabled="pending"
        />
      </UiFormFieldset>
    </UiForm>
    <p class="py-2 text-center">
      Already have an account? <NuxtLink to="/signin" class="underline hover:no-underline">Sign in</NuxtLink>
    </p>
  </UiBubble>
</template>
<script setup lang="ts">
import type { ValidationRule } from '~/types/validation.d'
import type { EstimateCrack } from '~/types/password.d'
import { TimeUnits } from '~/types/password.d'
import UiForm from '~/components/ui/Form.vue'

interface Data {
  name: string
  email: string
  password: string
  passwordConfirmation: string
  agreeToTerms: boolean
}

interface Rule extends ValidationRule {
  passed: boolean
}

definePageMeta({
  middleware: 'guest',
  layout: 'auth',
})

useSeoMeta({
  title: 'Sign up',
})

const { Validation } = useValidation()
const { estimateTimeToCrack } = usePassword()

const form = ref<InstanceType<typeof UiForm> | null>()
const isFocused = shallowRef(false)
const displayPassword = shallowRef<boolean>(false)
const displayPasswordConfirmation = shallowRef<boolean>(false)

const data = shallowReactive<Data>({
  name: '',
  email: '',
  password: '',
  passwordConfirmation: '',
  agreeToTerms: false,
})

const type = computed<'password' | 'text'>(() => {
  return displayPassword.value ? 'text' : 'password'
})
const typeConfirmation = computed<'password' | 'text'>(() => {
  return displayPasswordConfirmation.value ? 'text' : 'password'
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
const revealIconConfirmation = computed<
  'lucide:eye' | 'lucide:eye-closed'
>(() => {
  return displayPasswordConfirmation.value
    ? 'lucide:eye-closed'
    : 'lucide:eye'
})
const revealTip = computed(() => {
  return displayPassword.value ? 'Hide password' : 'Show password'
})
const revealTipConfirmation = computed(() => {
  return displayPasswordConfirmation.value ? 'Hide confirmation password' : 'Show confirmation password'
})

const formatRule = (rule: ValidationRule) => ({
  ...rule,
  passed: rule.validate(data.password),
})

const rules = reactive<Rule[]>(
  [
    Validation.min(8),
    Validation.digit(),
    Validation.uppercase(),
    Validation.specialChar(),
  ].map(formatRule),
)

const updateRulesStatus = () => {
  for (const rule of rules) {
    rule.passed = rule.validate(data.password)
  }
}

const allRulesPassed = computed<boolean>(() => {
  return rules.every(rule => rule.passed)
})

const estimate = computed<EstimateCrack>(() => {
  return estimateTimeToCrack(data.password)
})

const timeToCrack = computed<string>(() => {
  return estimate.value.text
})

const timeToCrackHighlight = computed(() => {
  const { unit } = estimate.value

  return {
    'badge-error': [TimeUnits.seconds, TimeUnits.minutes].includes(unit),
    'badge-warning': unit === TimeUnits.hours,
    'badge-info': unit === TimeUnits.days,
    'badge-success': unit === TimeUnits.years,
  }
})

const { $auth } = useNuxtApp()

const pending = shallowRef<boolean>(false)

async function socialSignIn(provider: 'google' | 'github') {
  try {
    pending.value = true
    await $auth.signIn.social({
      provider,
    })
    useSuccessMessage(`Successfully signed in with ${provider}`)
    await navigateTo('/chats/new')
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  } finally {
    pending.value = false
  }
}

async function onSubmit() {
  const { name, email, password } = data

  try {
    pending.value = true
    await $fetch('/api/v1/auth/sign-up', {
      method: 'post',
      body: {
        name,
        email,
        password,
      },
    })

    useSuccessMessage('Account created successfully! Please check your email to confirm your account.')
    navigateTo('/signin')
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.confirmation-enter-active,
.confirmation-leave-active,
.rules-enter-active,
.rules-leave-active {
    @apply transition-all;
}

.confirmation-enter-from,
.confirmation-leave-to {
    @apply translate-x-4 opacity-0;
}

.rules-enter-from,
.rules-leave-to {
    @apply -translate-y-4 opacity-0;
}
</style>
