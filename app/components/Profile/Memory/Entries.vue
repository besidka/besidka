<template>
  <div data-testid="memory-entries-section">
    <ProfileSecuritySectionCard
      heading="What Besidka remembers"
      :description="description"
    >
      <slot>
        <div
          class="flex flex-col items-center gap-2 rounded-box bg-base-content/5 px-4 py-8 text-center text-base-content/70"
        >
          <Icon name="lucide:brain" size="24" />
          <p class="text-sm">Nothing remembered yet.</p>
        </div>
      </slot>
    </ProfileSecuritySectionCard>
  </div>
</template>

<script setup lang="ts">
const description = 'Entries from your chats appear here, grouped by '
  + 'category, once memory generation has run.'
</script>
