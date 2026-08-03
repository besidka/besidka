<template>
  <h1 class="mb-8 text-4xl font-bold text-center">Account</h1>
  <ul class="grid gap-4">
    <li>
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
    </li>
    <li>
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
    </li>
    <li>
      <NuxtLink
        to="/profile/security"
        class="bubble flex items-center justify-between gap-4 p-6 hover:opacity-80"
      >
        <div>
          <p class="font-bold">Security</p>
          <p class="mt-1 text-sm text-base-content/70">
            Manage two-factor authentication, passkeys, sign-in methods,
            sessions, and account removal.
          </p>
        </div>
        <Icon name="lucide:chevron-right" size="20" />
      </NuxtLink>
    </li>
  </ul>
</template>
<script setup lang="ts">
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
</script>
