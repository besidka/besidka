<template>
  <div
    v-if="attachments.length"
    class="mb-2 flex flex-wrap gap-1.5"
    role="group"
    aria-label="Attached artifacts"
    data-testid="message-artifact-attachments"
  >
    <button
      v-for="attachment in attachments"
      :key="attachment.artifactId"
      type="button"
      class="flex max-w-full items-center gap-2 rounded-box border border-base-300 bg-base-200 py-1.5 pr-3 pl-2 text-left text-sm cursor-pointer transition-colors duration-150 hover:bg-base-300/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :aria-label="`Open attached artifact ${attachment.title}`"
      data-testid="message-artifact-attachment"
      @click="onOpen(attachment)"
    >
      <span class="grid size-6 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          :name="ARTIFACT_KIND_ICONS[attachment.kind]"
          size="14"
          aria-hidden="true"
        />
      </span>
      <span class="min-w-0 truncate font-medium">
        {{ attachment.title }}
      </span>
      <span class="shrink-0 text-xs text-base-content/60">
        {{ ARTIFACT_KIND_LABELS[attachment.kind] }} · v{{ attachment.version }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import type { DataArtifactPartData } from '#shared/utils/artifacts'
import { isDataArtifactAttachmentPart } from '#shared/utils/artifacts'
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
} from '~/utils/artifact-parts'

const props = defineProps<{
  message: Pick<UIMessage, 'role' | 'parts'>
}>()

const panel = useArtifactPanel()

const attachments = computed<DataArtifactPartData[]>(() => {
  if (props.message.role !== 'user') {
    return []
  }

  return props.message.parts.filter(isDataArtifactAttachmentPart)
    .map(part => part.data)
})

function onOpen(attachment: DataArtifactPartData) {
  panel.open({
    artifactId: attachment.artifactId,
    version: null,
    kind: attachment.kind,
    title: attachment.title,
    source: 'owner',
  })
}
</script>
