<template>
  <div class="pb-24">
    <div class="mb-8 flex items-center justify-between gap-4">
      <UiButton
        to="/chats/new"
        ghost
        mode="default"
        normal-case
        size="sm"
        text="Back to Chat"
        class="group/cta"
      >
        <template #icon>
          <Icon
            name="lucide:arrow-left"
            size="20"
            class="cta-icon-left"
          />
        </template>
      </UiButton>
      <div class="flex items-center gap-2">
        <SidebarThemeSwitcher
          show-label
          size="sm"
        />
        <UiButton
          ghost
          normal-case
          size="sm"
          text="Sign out"
          class="group/cta"
          :disabled="isSigningOut"
          data-testid="settings-sign-out"
          @click="signOut"
        >
          <template #icon>
            <Icon
              name="lucide:log-out"
              size="20"
              class="cta-icon-left"
            />
          </template>
        </UiButton>
      </div>
    </div>
    <div class="grid gap-8 sm:grid-cols-3">
      <div
        class="flex flex-col items-center gap-3 text-center"
      >
        <div
          class="avatar rounded-full"
          :class="{ 'avatar-placeholder': !user?.image }"
        >
          <div
            class="bubble w-20 rounded-full bg-base-100 dark:bg-base-content/50 text-text dark:text-base-100 shadow-none"
          >
            <img
              v-if="user?.image"
              :alt="user.name"
              :src="user.image"
            >
            <Icon
              v-else
              name="lucide:user-round"
              size="32"
            />
          </div>
        </div>
        <div class="grid gap-1">
          <p class="text-lg font-bold">{{ user?.name }}</p>
          <p class="text-sm break-all text-base-content/70">{{ user?.email }}</p>
        </div>
      </div>
      <div class="sm:col-span-2">
        <h1 class="mb-4 text-2xl font-bold">Account</h1>
        <div class="rounded-box border border-error bg-base-100 p-6">
          <h2 class="text-lg font-bold text-error">Danger Zone</h2>
          <p class="mt-2 text-sm text-base-content/70">
            Permanently delete your account and all associated data.
          </p>
          <UiButton
            class="mt-4"
            mode="error"
            size="sm"
            icon-name="lucide:trash-2"
            text="Delete Account"
            :disabled="isDeleting"
            data-testid="settings-delete-account"
            @click="deleteAccount"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Settings',
  robots: 'noindex, nofollow',
})

const $auth = useAuth()
const { user } = $auth

const isSigningOut = shallowRef<boolean>(false)
const isDeleting = shallowRef<boolean>(false)

async function signOut() {
  isSigningOut.value = true

  try {
    await $auth.signOut({
      redirectTo: '/signin',
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to sign out.',
      parsedException.why,
    )
  } finally {
    isSigningOut.value = false
  }
}

async function deleteAccount() {
  const result = await useConfirm({
    text: 'Permanently delete your account?',
    subtitle: 'We will email you a confirmation link. Opening it erases your '
      + 'account, chats, projects and files for good — this cannot be undone.',
    alert: true,
    actions: ['Delete account'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isDeleting.value = true

  try {
    await $auth.requestAccountDeletion()

    useInfoMessage(
      'Check your email',
      'We sent a link to confirm deleting your account.',
    )
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to request account deletion.',
      parsedException.why,
    )
  } finally {
    isDeleting.value = false
  }
}
</script>
