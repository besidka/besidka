<template>
  <div class="grid gap-6">
    <AdminRolloutNotice v-if="data && !data.rolloutEnabled" />
    <div
      v-if="status === 'pending' && !data"
      class="grid gap-2"
      data-testid="admin-features-loading"
    >
      <div
        v-for="index in 6"
        :key="index"
        class="skeleton skeleton--default h-12 w-full"
      />
    </div>
    <div
      v-else-if="error || !data"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="admin-features-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>The feature list did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="refresh()"
      />
    </div>
    <template v-else>
      <div class="bubble rounded-box overflow-x-auto max-md:hidden">
        <table
          class="table table-sm"
          data-testid="admin-features-table"
        >
          <thead>
            <tr>
              <th>Feature</th>
              <th>Stage</th>
              <th>Access</th>
              <th class="text-right">Grants</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="feature in rows"
              :key="feature.key"
              class="hover:bg-base-200/60"
            >
              <td>
                <NuxtLink
                  :to="`/admin/features/${feature.key}`"
                  class="link link-hover grid"
                  :class="{ 'pl-4': feature.parent }"
                >
                  <span class="font-medium">{{ feature.title }}</span>
                  <code class="text-xs opacity-70">{{ feature.key }}</code>
                </NuxtLink>
              </td>
              <td>
                <span class="badge badge-soft badge-sm">
                  {{ feature.stage }}
                </span>
              </td>
              <td>
                <AdminFeatureStateBadge :state="feature.state" />
              </td>
              <td class="text-right tabular-nums">
                {{ feature.grantCounts.allow }} / {{ feature.grantCounts.deny }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul
        class="grid gap-3 md:hidden"
        data-testid="admin-features-cards"
      >
        <li
          v-for="feature in rows"
          :key="feature.key"
        >
          <NuxtLink
            :to="`/admin/features/${feature.key}`"
            class="bubble rounded-box grid gap-2 p-4"
          >
            <span class="flex items-start justify-between gap-2">
              <span class="grid">
                <span class="font-medium">{{ feature.title }}</span>
                <code class="text-xs opacity-70 break-all">
                  {{ feature.key }}
                </code>
              </span>
              <span class="badge badge-soft badge-sm">{{ feature.stage }}</span>
            </span>
            <span class="flex items-center justify-between gap-2 text-sm">
              <AdminFeatureStateBadge :state="feature.state" />
              <span class="tabular-nums opacity-70">
                {{ feature.grantCounts.allow }} allow ·
                {{ feature.grantCounts.deny }} deny
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
      <p class="text-xs text-base-content/70">
        Grants are shown as allow / deny. Rule changes take effect within 5
        minutes.
      </p>
    </template>
  </div>
</template>
<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Features · Admin',
  robots: 'noindex, nofollow',
})

const { data, status, error, refresh } = await useLazyFetch(
  '/api/v1/admin/features',
)

const rows = computed(() => {
  if (!data.value) {
    return []
  }

  const options = {
    rolloutEnabled: data.value.rolloutEnabled,
    hostMode: data.value.hostMode,
  }

  return data.value.flags.map((feature) => {
    return {
      ...feature,
      state: getAdminFeatureState(feature, options),
    }
  })
})
</script>
