<template>
  <h1 class="mb-8 text-4xl font-bold text-center">Security</h1>
  <div class="grid gap-6">
    <NuxtLink
      to="/profile/email"
      class="bubble flex items-center justify-between gap-4 p-6 hover:opacity-80"
    >
      <div>
        <p class="font-bold">Email address</p>
        <p class="mt-1 text-sm text-base-content/70">
          Change the email address used to sign in.
        </p>
      </div>
      <Icon name="lucide:chevron-right" size="20" />
    </NuxtLink>
    <NuxtLink
      to="/profile/password"
      class="bubble flex items-center justify-between gap-4 p-6 hover:opacity-80"
    >
      <div>
        <p class="font-bold">Password</p>
        <p class="mt-1 text-sm text-base-content/70">
          Change your account password.
        </p>
      </div>
      <Icon name="lucide:chevron-right" size="20" />
    </NuxtLink>
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
      <ProfileSecurityTwoFactor />
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Passkeys"
      description="Sign in without a password using your device."
    >
      <ProfileSecurityPasskeys />
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      heading="Active sessions"
      description="See where you're signed in and end unfamiliar sessions."
    >
      <ProfileSecuritySessions />
    </ProfileSecuritySectionCard>
    <ProfileSecuritySectionCard
      id="privacy-consent"
      heading="Privacy & consent"
      :description="privacyConsentDescription"
    >
      <ProfileSecurityPrivacyConsent />
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
        @click="requestAccountDeletion"
      />
    </ProfileSecuritySectionCard>
  </div>
</template>
<script setup lang="ts">
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

const {
  isDeleting,
  requestAccountDeletion,
} = useAccountDeletion()

const privacyConsentDescription = 'Your consent to store sensitive '
  + 'information in your chats, and to send messages to providers outside '
  + 'the EU.'
</script>
