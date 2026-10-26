<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Preferences</h1>
    <h2 class="mt-2">Choose how Besidka behaves by default</h2>
  </div>
  <div class="grid gap-6">
    <ProfileSecuritySectionCard heading="Notifications">
      <div class="grid gap-2">
        <label
          class="flex items-start justify-between gap-4"
          :class="isPushToggleDisabled ? 'opacity-60' : 'cursor-pointer'"
        >
          <span class="grid gap-1">
            <span
              id="push-notifications-title"
              class="font-bold"
            >Push notifications</span>
            <span
              id="push-notifications-description"
              class="text-sm text-base-content/70"
            >
              Get a notification when a response finishes while you're away,
              and when you open a shared chat in the installed app. They never
              include your messages. This applies to this browser only.
            </span>
          </span>
          <span
            v-if="!isMounted"
            class="skeleton skeleton--default mt-1 h-6 w-10 shrink-0 rounded-full"
            data-testid="preferences-push-skeleton"
          />
          <input
            v-else
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="push-notifications-title"
            aria-describedby="push-notifications-description"
            data-testid="preferences-push-toggle"
            :checked="isPushEnabled"
            :disabled="isPushToggleDisabled"
            @click.prevent="togglePush()"
          >
        </label>
        <p
          class="min-h-4 text-xs text-base-content/60"
          data-testid="preferences-push-status"
        >
          {{ pushStatusNote }}
        </p>
      </div>
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard heading="Reasoning">
      <div class="grid gap-5">
        <fieldset class="grid gap-2">
          <legend
            id="default-reasoning-title"
            class="font-bold"
          >
            Default reasoning effort
          </legend>
          <p
            id="default-reasoning-description"
            class="text-sm text-base-content/70"
          >
            Used for new chats. Models that can't use this level pick the
            closest one they support.
          </p>
          <div
            v-if="!isSettingsLoaded"
            class="skeleton skeleton--default h-8 w-full rounded-box"
            data-testid="preferences-reasoning-skeleton"
          />
          <div
            v-else
            role="radiogroup"
            aria-labelledby="default-reasoning-title"
            aria-describedby="default-reasoning-description"
            class="tabs tabs-box tabs-sm w-full"
            data-testid="default-reasoning-level"
          >
            <input
              v-for="level in levelOptions"
              :key="level.value"
              type="radio"
              name="default-reasoning-level"
              class="tab grow basis-0"
              :aria-label="level.label"
              :value="level.value"
              :checked="selectedLevel === level.value"
              :data-testid="`default-reasoning-level-${level.value}`"
              @click="onLevelClick(level.value)"
            >
          </div>
          <p
            class="min-h-4 text-xs text-base-content/60"
            data-testid="default-reasoning-product-default"
          >
            <template v-if="isSettingsLoaded && defaultReasoningLevel === null">
              Product default
            </template>
          </p>
        </fieldset>
        <label class="flex items-start justify-between gap-4 cursor-pointer">
          <span class="grid gap-1">
            <span
              id="reasoning-expanded-title"
              class="font-bold"
            >Show reasoning steps expanded</span>
            <span
              id="reasoning-expanded-description"
              class="text-sm text-base-content/70"
            >
              Opens the model's reasoning steps while it thinks.
            </span>
          </span>
          <span
            v-if="!isSettingsLoaded"
            class="skeleton skeleton--default mt-1 h-6 w-10 shrink-0 rounded-full"
            data-testid="preferences-expanded-skeleton"
          />
          <input
            v-else
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="reasoning-expanded-title"
            aria-describedby="reasoning-expanded-description"
            data-testid="preferences-reasoning-expanded-toggle"
            :checked="reasoningExpanded"
            @change="onExpandedChange"
          >
        </label>
        <label
          class="ms-6 flex items-start justify-between gap-4 border-s ps-4"
          :class="reasoningExpanded ? 'cursor-pointer' : 'opacity-60'"
        >
          <span class="grid gap-1">
            <span
              id="reasoning-auto-hide-title"
              class="font-bold"
            >Auto-hide when done</span>
            <span
              id="reasoning-auto-hide-description"
              class="text-sm text-base-content/70"
            >
              Collapses the reasoning steps once the answer is ready.
            </span>
          </span>
          <span
            v-if="!isSettingsLoaded"
            class="skeleton skeleton--default mt-1 h-6 w-10 shrink-0 rounded-full"
            data-testid="preferences-auto-hide-skeleton"
          />
          <input
            v-else
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="reasoning-auto-hide-title"
            aria-describedby="reasoning-auto-hide-description"
            data-testid="preferences-reasoning-auto-hide-toggle"
            :checked="reasoningAutoHide"
            :disabled="!reasoningExpanded"
            @change="onAutoHideChange"
          >
        </label>
      </div>
    </ProfileSecuritySectionCard>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningLevel } from '#shared/types/reasoning.d'

interface LevelOption {
  value: ReasoningLevel
  label: string
}

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Preferences',
  robots: 'noindex, nofollow',
})

const levelOptions: LevelOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const {
  isSettingsLoaded,
  defaultReasoningLevel,
  reasoningExpanded,
  reasoningAutoHide,
  setDefaultReasoningLevel,
  setReasoningExpanded,
  setReasoningAutoHide,
} = useUserSetting()

const {
  isSupported: isPushSupported,
  isEnabled: isPushEnabled,
  isBlocked: isPushBlocked,
  pending: isPushPending,
  toggle: togglePush,
} = usePushToggle()

const isMounted = shallowRef<boolean>(false)

onMounted(() => {
  isMounted.value = true
})

const isPushToggleDisabled = computed<boolean>(() => {
  return !isPushSupported.value || isPushBlocked.value || isPushPending.value
})

const pushStatusNote = computed<string>(() => {
  if (!isMounted.value) {
    return ''
  }

  if (!isPushSupported.value) {
    return 'This browser doesn\'t support push notifications.'
  }

  if (isPushBlocked.value) {
    return 'Blocked in browser settings. Allow notifications for this site '
      + 'to turn them on.'
  }

  return ''
})

const prefStorage = usePreferenceStorage()

const selectedLevel = computed<ReasoningLevel>(() => {
  return resolveInitialReasoningLevel(
    defaultReasoningLevel.value,
    prefStorage.getItem('settings_reasoning_level'),
  )
})

async function onLevelClick(level: ReasoningLevel) {
  if (level === defaultReasoningLevel.value) {
    return
  }

  await setDefaultReasoningLevel(level)
}

async function onExpandedChange(event: Event) {
  const input = event.target as HTMLInputElement

  await setReasoningExpanded(input.checked)
}

async function onAutoHideChange(event: Event) {
  const input = event.target as HTMLInputElement

  await setReasoningAutoHide(input.checked)
}
</script>
