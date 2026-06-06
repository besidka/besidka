<template>
  <div class="flex flex-col gap-2">
    <details
      v-for="(item, index) in items"
      :key="index"
      :name="groupName"
      class="group rounded-2xl bg-base-100/50 open:bg-base-100/70
        transition-colors"
    >
      <summary
        class="flex items-center justify-between gap-4 px-4 py-3
          cursor-pointer list-none text-base font-medium
          text-base-content select-none rounded-2xl
          focus-visible:outline-2 focus-visible:outline-primary
          focus-visible:outline-offset-2"
      >
        <span>{{ item.question }}</span>
        <Icon
          name="lucide:chevron-down"
          class="w-4 h-4 shrink-0 text-base-content/40
            transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p
        class="px-4 pb-4 pt-1 text-sm text-base-content/70
          leading-relaxed whitespace-pre-line"
      >
        {{ item.answer }}
      </p>
    </details>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  items: { question: string, answer: string }[]
  groupName?: string
}>(), {
  groupName: 'faq',
})
</script>
