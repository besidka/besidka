<template>
  <details
    v-if="note"
    class="group collapse mb-2"
    data-testid="google-tools-withheld"
  >
    <summary
      :id="`google-tools-withheld-${message.id}-label`"
      :aria-controls="`google-tools-withheld-${message.id}-content`"
      class="
        collapse-title flex items-center gap-1 p-0 text-xs
        text-base-content/70
      "
      data-testid="google-tools-withheld-summary"
    >
      <Icon name="lucide:info" size="12" />
      <span>{{ note.summary }}</span>
      <Icon
        name="lucide:chevron-right"
        class="text-base-content/60 transition-transform group-open:rotate-90"
      />
    </summary>
    <div
      :id="`google-tools-withheld-${message.id}-content`"
      class="pt-2"
    >
      <ChatInputToolsMenuInfoNote data-testid="google-tools-withheld-detail">
        {{ note.detail }}
        <NuxtLink
          v-if="note.linkLabel"
          :to="GOOGLE_TOOLS_WITHHELD_KEYS_PATH"
          class="link block mt-1"
          data-testid="google-tools-withheld-link"
        >
          {{ note.linkLabel }}
        </NuxtLink>
      </ChatInputToolsMenuInfoNote>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import { getMessageMetadata } from '#shared/utils/message-metadata'
import { resolveProviderMetaByKeyProviderId } from '#shared/utils/provider-meta'
import {
  GOOGLE_TOOLS_WITHHELD_KEYS_PATH,
  getGoogleToolsWithheldNote,
  getGoogleToolsWithheldReason,
} from '#shared/utils/google-tools-withheld'
import type {
  GoogleToolsWithheldNote,
} from '#shared/utils/google-tools-withheld'

const props = defineProps<{
  message: UIMessage
}>()

const directProviderId = computed<string | null>(() => {
  const usageProvider = getMessageMetadata(props.message).usage?.provider

  if (!usageProvider) {
    return null
  }

  const meta = resolveProviderMetaByKeyProviderId(usageProvider)

  return meta?.kind === 'provider' ? meta.id : null
})

const note = computed<GoogleToolsWithheldNote | null>(() => {
  const reason = getGoogleToolsWithheldReason(props.message)

  return reason
    ? getGoogleToolsWithheldNote(reason, {
      providerId: directProviderId.value,
    })
    : null
})
</script>
