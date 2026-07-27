<template>
  <div class="relative z-30">
    <div class="relative w-full max-w-4xl mx-auto py-8 px-3 sm:px-24">
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
              mode="default"
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
                  class="cta-icon order-last"
                />
              </template>
            </UiButton>
          </div>
        </div>
        <div class="grid gap-8 md:grid-cols-3">
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
            <nav
              aria-label="Account sections"
              class="tabs tabs-box tabs-sm mb-6 w-full"
            >
              <NuxtLink
                v-for="tab in tabs"
                :key="tab.to"
                :to="tab.to"
                class="tab grow"
                exact-active-class="tab-active"
              >
                {{ tab.label }}
              </NuxtLink>
            </nav>
            <NuxtPage />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

const $auth = useAuth()
const { user } = $auth

const isSigningOut = shallowRef<boolean>(false)

const tabs = [
  { to: '/profile/settings', label: 'Account' },
  { to: '/profile/keys', label: 'API Keys' },
]

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
</script>
