<template>
  <h1 class="mb-8 text-4xl font-bold text-center">Security</h1>
  <div class="grid gap-6">
    <ProfileSecuritySectionCard
      heading="Sign-in methods"
      description="Connect or disconnect ways to sign in to your account."
    >
      <ProfileSecurityLinkedAccounts />
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Two-factor authentication"
      description="Add a second sign-in step to protect your account."
    >
      <p class="badge badge-neutral">Coming soon</p>
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Passkeys"
      description="Sign in without a password using your device."
    >
      <p class="badge badge-neutral">Coming soon</p>
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Active sessions"
      description="See where you're signed in and end unfamiliar sessions."
    >
      <ProfileSecuritySessions />
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Account removal"
      description="Permanently delete your account and all associated data."
      danger
    >
      <UiButton
        mode="error"
        size="sm"
        icon-name="lucide:trash-2"
        text="Delete Account"
        :disabled="isDeleting"
        data-testid="settings-delete-account"
        @click="deleteAccount"
      />
    </ProfileSecuritySectionCard>
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
  title: 'Security',
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
