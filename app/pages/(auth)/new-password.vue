<template>
  <UiBubble class="grow w-full min-sm:max-w-md z-20">
    <div class="my-4 text-center">
      <h1 class="mb-2 text-3xl font-bold capitalize">
        <template v-if="!token">
          Invalid reset link
        </template>
        <template v-else>
          Set a new password
        </template>
      </h1>
      <p class="opacity-80">
        <template v-if="!token">
          This password reset link is invalid or has expired
        </template>
        <template v-else>
          Enter your new password below
        </template>
      </p>
    </div>
    <LazyUiForm
      v-if="token"
      ref="form"
      class="w-full"
      @submit="onSubmit"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="data.password"
          autocomplete="new-password"
          :type="type"
          placeholder="Enter your new password"
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
                    'to-base-200': !data.password,
                    'to-error/30': data.password && !allRulesPassed,
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
                  <strong class="badge text-xs" :class="timeToCrackHighlight">{{ timeToCrack }}</strong>
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
      </UiFormFieldset>
      <UiFormFieldset :inputs="false" class="flex justify-center mt-4">
        <UiButton
          type="submit"
          :text="pending ? 'Updating...' : 'Update Password'"
          icon-name="lucide:key"
          class="w-full"
          :disabled="pending"
        />
      </UiFormFieldset>
    </LazyUiForm>
    <p
      v-else
      class="grid place-items-center py-2"
    >
      <span class="flex items-center justify-center size-16 mb-2 bg-error rounded-full">
        <Icon
          name="lucide:alert-triangle"
          size="32"
          class="text-error-content"
        />
      </span>
    </p>
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
import type { ValidationRule } from '~/types/validation.d'
import type { EstimateCrack } from '~/types/password.d'
import { TimeUnits } from '~/types/password.d'
import UiForm from '~/components/ui/Form.vue'

interface Data {
  password: string
  passwordConfirmation: string
}

interface Rule extends ValidationRule {
  passed: boolean
}

definePageMeta({
  layout: 'auth',
  auth: {
    only: 'guest',
  },
})

useSeoMeta({
  title: 'Set a new password',
  robots: 'noindex, nofollow',
})

const { Validation } = useValidation()
const { estimateTimeToCrack } = usePassword()
const route = useRoute()

const token = computed<string>(() => {
  return (route.query.token || '').toString().trim()
})

const form = ref<InstanceType<typeof UiForm> | null>()
const isFocused = shallowRef(false)
const displayPassword = shallowRef<boolean>(false)
const displayPasswordConfirmation = shallowRef<boolean>(false)

const data = shallowReactive<Data>({
  password: '',
  passwordConfirmation: '',
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

const pending = shallowRef<boolean>(false)
const { resetPassword } = useAuth()

async function onSubmit() {
  pending.value = true

  try {
    await resetPassword({
      newPassword: data.password,
      fetchOptions: {
        async onSuccess() {
          useSuccessMessage('Password updated successfully!')
          await navigateTo('/signin')
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
