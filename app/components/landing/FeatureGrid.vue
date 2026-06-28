<template>
  <div
    class="grid gap-3"
    :class="{
      'grid-cols-1 sm:grid-cols-2': columns === 2,
      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3': columns === 3,
      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4': columns === 4,
    }"
  >
    <div
      v-for="(feature, index) in features"
      :key="index"
      class="flex flex-col gap-2 p-5 rounded-2xl
        bg-base-100/50 dark:bg-base-content/5"
    >
      <div
        class="w-9 h-9 rounded-xl bg-base-200 grid place-items-center
          text-accent"
      >
        <Icon
          :name="feature.icon"
          class="w-5 h-5"
          aria-hidden="true"
        />
      </div>
      <h3 class="text-base font-semibold text-base-content leading-snug">
        {{ feature.title }}
      </h3>
      <p class="text-sm text-base-content/70 leading-relaxed">
        {{ feature.body }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  features: { icon: string, title: string, body: string }[]
  columns?: 2 | 3 | 4
}>(), {
  columns: 3,
})
</script>
