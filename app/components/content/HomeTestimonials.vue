<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
    <div
      v-for="(item, index) in resolvedItems"
      :key="index"
      class="bg-base-100/50 dark:bg-base-content/5 rounded-2xl p-4
        flex flex-col gap-3"
    >
      <Icon
        name="lucide:quote"
        class="w-5 h-5 text-primary/60"
        aria-hidden="true"
      />
      <blockquote
        class="text-sm text-base-content leading-relaxed not-italic"
      >
        {{ item.quote }}
      </blockquote>
      <p
        class="mt-auto text-xs text-base-content/60 border-t
          border-base-content/20 pt-3"
      >
        — {{ item.author
        }}<template v-if="item.role">, {{ item.role }}</template>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type Testimonial = { quote: string, author: string, role?: string }

const props = withDefaults(defineProps<{
  items?: Testimonial[]
}>(), {
  items: () => [],
})

const data = inject<MaybeRefOrGetter<{ testimonials?: Testimonial[] }>>(
  'home:data',
  {},
)

const resolvedItems = computed<Testimonial[]>(() => {
  if (props.items.length) {
    return props.items
  }

  return toValue(data)?.testimonials ?? []
})
</script>
