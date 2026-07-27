<template>
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
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Settings',
  robots: 'noindex, nofollow',
})

const $auth = useAuth()

const isDeleting = shallowRef<boolean>(false)

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
