<template>
  <div
    v-if="compact"
    data-testid="models-picker-key-banner"
    class="shrink-0 flex items-center gap-2 px-2.5 py-2 rounded-t-2xl border-b border-warning/30 bg-warning/10"
  >
    <Icon
      name="lucide:key-round"
      size="14"
      class="shrink-0 text-warning"
    />
    <span class="grow min-w-0 text-xs">
      <span class="block truncate font-semibold text-warning">
        {{ title }}
      </span>
      <span class="block truncate opacity-70">
        {{ description }}
      </span>
    </span>
    <NuxtLink
      to="/profile/keys"
      data-testid="models-picker-key-banner-link"
      class="btn btn-warning btn-xs shrink-0 gap-1 rounded-full"
      @click="emit('navigate')"
    >
      {{ actionLabel }}
    </NuxtLink>
  </div>
  <div
    v-else
    data-testid="models-picker-key-prompt"
    class="min-h-full flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
  >
    <Icon
      name="lucide:key-round"
      size="24"
      class="text-warning"
    />
    <p class="text-sm font-semibold">
      {{ title }}
    </p>
    <p class="max-w-xs text-xs opacity-60">
      {{ description }}
    </p>
    <NuxtLink
      to="/profile/keys"
      data-testid="models-picker-key-prompt-link"
      class="btn btn-warning btn-xs mt-1 gap-1 rounded-full"
      @click="emit('navigate')"
    >
      <Icon
        name="lucide:plus"
        size="12"
      />
      {{ actionLabel }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description: string
    actionLabel?: string
    compact?: boolean
  }>(),
  {
    actionLabel: 'Add a key',
  },
)

const emit = defineEmits<{
  navigate: []
}>()
</script>
