<template>
  <ProfileSecuritySectionCard heading="What memory never keeps">
    <div class="grid gap-5">
      <p
        class="text-sm text-base-content/70"
        data-testid="memory-never-kept-note"
      >
        Sensitive topics (health, religion, politics and similar) are never
        saved to memory.
        <NuxtLink
          to="/privacy-policy"
          class="link"
          data-testid="memory-never-kept-privacy-link"
        >See the Privacy Policy.</NuxtLink>
      </p>
      <div>
        <h3 class="text-sm font-bold">Never stored, even if you ask</h3>
        <ul
          class="mt-2 grid gap-1 sm:grid-cols-2"
          data-testid="memory-never-store-list"
        >
          <li
            v-for="kind in neverStoreKinds"
            :key="kind.id"
            class="flex items-center gap-2 text-sm text-base-content/70"
          >
            <Icon
              name="lucide:ban"
              size="14"
              class="shrink-0"
            />
            {{ kind.label }}
          </li>
        </ul>
      </div>
    </div>
  </ProfileSecuritySectionCard>
</template>
