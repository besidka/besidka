<template>
  <ProfileSecuritySectionCard
    heading="Extra memory checks"
    :description="description"
  >
    <ClientOnly>
      <div
        v-if="status === 'saved'"
        class="grid gap-1 text-sm"
      >
        <p
          class="flex items-center gap-2"
          data-testid="memory-checks-on"
        >
          <Icon
            name="lucide:shield-check"
            size="16"
            class="shrink-0 text-success"
          />
          Memory checks: TypeSafe AI Jev ({{ memoryChecksState }})
        </p>
        <NuxtLink
          :to="checksSettingsPath"
          class="link"
          data-testid="memory-checks-settings-link"
        >
          Choose which TypeSafe AI checks run
        </NuxtLink>
      </div>
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
import { isJevRoleSwitchedOn } from '#shared/utils/jev-policy'
import type { JevRoleSettings } from '#shared/utils/jev-policy'

const props = defineProps<{
  typesafeRoles?: JevRoleSettings | null
}>()

const keysPath = '/profile/keys?provider=typesafe'
const checksSettingsPath = '/profile/keys?tab=memory-checks'
const description = 'An optional second opinion on every memory save, run '
  + 'on your own TypeSafe AI key. Memory works without it.'

const { keyStatusForProvider } = useUserKeys()

const status = computed<UserKeyStatus>(() => {
  return keyStatusForProvider('typesafe')
})

const memoryChecksState = computed<string>(() => {
  return isJevRoleSwitchedOn(props.typesafeRoles, 'memoryChecks')
    ? 'on'
    : 'off'
})
</script>
