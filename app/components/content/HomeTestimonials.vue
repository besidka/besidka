<template>
    <div
      v-if="resolvedItems?.length"
      class="grid grid-cols-1 lg:grid-cols-3 gap-3
        lg:grid-rows-[auto_auto_1fr_auto]"
    >
      <div
        v-for="(item, index) in resolvedItems"
        :key="index"
        class="bg-base-100/50 dark:bg-base-content/5 rounded-2xl p-4
          flex flex-col gap-3 lg:grid lg:grid-rows-subgrid
          lg:row-span-4"
      >
        <div
          class="size-9 rounded-xl bg-base-200 grid place-items-center
            text-accent"
        >
          <Icon
            :name="item.icon"
            class="size-5"
            aria-hidden="true"
          />
        </div>
        <p class="font-semibold text-sm text-base-content">
          {{ item.persona }}
        </p>
        <p class="text-sm text-base-content/80 leading-relaxed flex-1">
          {{ item.scenario }}
        </p>
        <p
          class="text-xs text-accent font-medium border-t
            border-base-content/20 pt-3"
        >
          {{ item.payoff }}
        </p>
      </div>
    </div>
</template>

<script setup lang="ts">
import type { MaybeRefOrGetter } from 'vue'

type UseCase = {
  icon: string
  persona: string
  scenario: string
  payoff: string
}

const props = withDefaults(defineProps<{
  items?: UseCase[]
}>(), {
  items: () => [],
})

const data = inject<MaybeRefOrGetter<{ useCases?: UseCase[] }>>(
  'home:data',
  {},
)

const resolvedItems = computed<UseCase[]>(() => {
  if (props.items.length) {
    return props.items
  }

  return toValue(data)?.useCases ?? []
})
</script>
