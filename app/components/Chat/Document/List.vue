<template>
  <component
    :is="ordered ? 'ol' : 'ul'"
    class="ms-5 grid gap-1"
    :class="ordered ? 'list-decimal' : 'list-disc'"
  >
    <li
      v-for="(item, itemIndex) in items"
      :key="`item-${itemIndex}`"
    >
      <ChatDocumentRuns :runs="item.runs" />
      <ChatDocumentList
        v-if="getChildren(item).length > 0"
        :items="getChildren(item)"
        :ordered="ordered"
        class="mt-1"
      />
    </li>
  </component>
</template>

<script setup lang="ts">
import type { ListItem } from '@besidka/doc-renderer/spec'

defineOptions({ name: 'ChatDocumentList' })

defineProps<{
  items: ListItem[]
  ordered: boolean
}>()

function getChildren(item: ListItem): ListItem[] {
  return (item.children ?? []) as ListItem[]
}
</script>
