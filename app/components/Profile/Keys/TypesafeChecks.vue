<template>
  <section
    id="typesafe-ai-checks"
    class="grid gap-4 rounded-box border border-base-300 p-4 sm:p-6"
    aria-labelledby="typesafe-ai-checks-heading"
    data-testid="typesafe-checks"
  >
    <h3
      id="typesafe-ai-checks-heading"
      class="text-lg font-bold"
    >
      TypeSafe AI checks
    </h3>
    <div
      role="alert"
      class="alert alert-soft alert-info !items-start text-sm"
      data-testid="typesafe-checks-info"
    >
      <Icon
        name="lucide:info"
        size="16"
        class="mt-0.5 shrink-0"
      />
      <p>
        TypeSafe AI, Inc. (US) receives only the text each enabled check
        needs. Data handling: SCCs, no training on API data. See the
        <NuxtLink
          :to="privacyPolicyPath"
          class="link"
          data-testid="typesafe-checks-privacy-link"
        >Privacy Policy</NuxtLink>.
      </p>
    </div>
    <ul class="grid gap-4">
      <li
        v-for="role in typesafeRoleCopies"
        :key="role.id"
      >
        <label
          class="flex items-start justify-between gap-4"
          :class="{ 'cursor-pointer': isLoaded }"
        >
          <span class="grid gap-1">
            <span
              :id="`typesafe-role-${role.id}-title`"
              class="font-bold"
            >{{ role.title }}</span>
            <span
              :id="`typesafe-role-${role.id}-description`"
              class="text-sm text-base-content/70"
            >{{ role.description }}</span>
          </span>
          <span class="mt-1 inline-flex h-7 w-14 shrink-0 justify-end">
            <input
              v-if="isLoaded"
              type="checkbox"
              class="toggle"
              :aria-labelledby="`typesafe-role-${role.id}-title`"
              :aria-describedby="`typesafe-role-${role.id}-description`"
              :data-testid="`typesafe-role-toggle-${role.id}`"
              :checked="isRoleOn(role.id)"
              @change="onToggle(role.id, $event)"
            >
            <span
              v-else
              class="skeleton skeleton--default h-6 w-12 rounded-full"
              :data-testid="`typesafe-role-skeleton-${role.id}`"
            />
          </span>
        </label>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { JevRoleId } from '#shared/utils/jev-policy'

const privacyPolicyPath = '/privacy-policy#typesafe-ai-checks'

const { isLoaded, isRoleOn, setRole } = useTypesafeRoles()

async function onToggle(role: JevRoleId, event: Event) {
  const input = event.target as HTMLInputElement

  await setRole(role, input.checked)

  input.checked = isRoleOn(role)
}
</script>
