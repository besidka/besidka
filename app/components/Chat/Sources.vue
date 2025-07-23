<template>
  <div
    v-if="sources.length"
    class="collapse collapse-arrow mt-4 border border-base-300 bg-base-100"
  >
    <input
      :id="`sources-${message.id}-checkbox`"
      :aria-labelledby="`sources-${message.id}-label`"
      type="checkbox"
    >
    <strong
      :id="`sources-${message.id}-label`"
      class="collapse-title flex items-center gap-2 font-semibold capitalize"
    >
      <Icon name="lucide:link" />
      Reference sources
    </strong>
    <div class="collapse-content text-sm">
      <ul class="list list-disc list-inside gap-1">
        <li
          v-for="source in sources"
          :key="source.sourceId"
        >
          <NuxtLink
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            external
            class="link"
          >
            {{ source.title || source.url }}
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, SourceUrlUIPart } from 'ai'

const props = defineProps<{
  message: UIMessage
}>()

const sources = computed<SourceUrlUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'source-url'
  }) as SourceUrlUIPart[]
})
</script>
