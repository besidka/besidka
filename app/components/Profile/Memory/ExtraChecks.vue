<template>
  <ProfileSecuritySectionCard
    heading="Extra memory checks"
    :description="description"
  >
    <ClientOnly>
      <p
        v-if="status === 'saved'"
        class="flex items-center gap-2 text-sm"
        data-testid="memory-checks-on"
      >
        <Icon
          name="lucide:shield-check"
          size="16"
          class="shrink-0 text-success"
        />
        Memory checks: TypeSafe AI Jev (on)
      </p>
      <NuxtLink
        v-else-if="status === 'missing'"
        :to="keysPath"
        class="link text-sm"
        data-testid="memory-checks-add-key"
      >
        Add a TypeSafe AI key for extra memory checks
      </NuxtLink>
      <div
        v-else
        class="skeleton skeleton--default h-5 w-64"
        data-testid="memory-checks-skeleton"
      />
      <template #fallback>
        <div class="skeleton skeleton--default h-5 w-64" />
      </template>
    </ClientOnly>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import type { UserKeyStatus } from '~/composables/user-keys'

const keysPath = '/profile/keys?provider=typesafe'
const description = 'An optional second opinion on every memory save, run '
  + 'on your own TypeSafe AI key. Memory works without it.'

const { keyStatusForProvider } = useUserKeys()

const status = computed<UserKeyStatus>(() => {
  return keyStatusForProvider('typesafe')
})
</script>
