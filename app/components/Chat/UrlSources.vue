<template>
  <div
    v-if="parts.length > 0"
    class="collapse collapse-arrow my-2 border border-base-300 bg-base-100"
  >
    <input
      :id="`url-sources-${message.id}-checkbox`"
      :aria-labelledby="`url-sources-${message.id}-label`"
      type="checkbox"
    >
    <strong
      :id="`url-sources-${message.id}-label`"
      class="collapse-title flex items-center gap-2 py-3 font-semibold text-sm"
    >
      <Icon name="lucide:link" />
      Links
    </strong>
    <div class="collapse-content ml-6 text-sm">
      <ul class="list list-disc list-inside gap-1">
        <li
          v-for="source in parts"
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

const parts = computed<SourceUrlUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'source-url'
  })
})
</script>
