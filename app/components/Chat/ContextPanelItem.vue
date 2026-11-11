<template>
  <span class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-field bg-base-200 text-base-content/70">
    <img
      v-if="thumbnailUrl"
      :src="thumbnailUrl"
      alt=""
      class="size-full object-cover"
      loading="lazy"
    >
    <Icon
      v-else
      :name="iconName"
      size="16"
      class="size-4"
    />
  </span>
  <span class="min-w-0 grow">
    <span class="block truncate text-sm leading-tight">{{ item.title }}</span>
    <span
      v-if="detail"
      class="block truncate text-xs leading-tight text-base-content/60"
    >
      {{ detail }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { toSafeLocalUrl } from '~/utils/chat-context'
import { ARTIFACT_KIND_LABELS } from '~/utils/artifact-parts'
import type {
  ChatContextItem,
  ChatContextItemKind,
  ChatContextItemMeta,
} from '#shared/types/chat-context.d'
import { isArtifactKind } from '#shared/utils/artifacts'

const props = defineProps<{
  item: ChatContextItem
}>()

const ICONS: Record<ChatContextItemKind, string> = {
  'image': 'lucide:image',
  'research': 'lucide:telescope',
  'file': 'lucide:paperclip',
  'knowledge': 'lucide:book-open',
  'memory': 'lucide:book-user',
  'chat-search': 'lucide:messages-square',
  'web-source': 'lucide:globe',
  'web-search': 'lucide:search',
  'artifact': 'lucide:app-window',
}

const DETAILS: Record<ChatContextItemKind, string> = {
  'image': 'Generated image',
  'research': 'Deep research',
  'file': 'Attached file',
  'knowledge': 'Project knowledge',
  'memory': 'Memory',
  'chat-search': 'Chat history',
  'web-source': 'Source',
  'web-search': 'Web search',
  'artifact': 'Artifact',
}

const thumbnailUrl = computed<string | null>(() => {
  return props.item.kind === 'image'
    ? toSafeLocalUrl(props.item.meta?.url)
    : null
})

function getArtifactDetail(meta: ChatContextItemMeta | undefined): string {
  const parts = [
    isArtifactKind(meta?.artifactKind)
      ? ARTIFACT_KIND_LABELS[meta.artifactKind]
      : DETAILS.artifact,
  ]

  if (meta?.version) {
    parts.push(`v${meta.version}`)
  }

  return parts.join(' · ')
}

const iconName = computed<string>(() => {
  return ICONS[props.item.kind]
})

const detail = computed<string>(() => {
  const { kind, meta } = props.item

  if (kind === 'web-search' && meta?.count) {
    return meta.count === 1 ? 'Used in 1 answer' : `Used in ${meta.count} answers`
  }

  if (kind === 'web-source' && meta?.domain) {
    return meta.domain
  }

  if (kind === 'artifact') {
    return getArtifactDetail(meta)
  }

  if ((kind === 'memory' || kind === 'chat-search') && meta?.action) {
    return meta.action
  }

  return DETAILS[kind]
})
</script>
