<template>
  <details
    v-if="sources.length > 0"
    class="group collapse mt-2"
  >
    <summary
      :id="`sources-url-${message.id}-label`"
      :aria-controls="`sources-url-${message.id}-content`"
      class="collapse-title flex items-center gap-1 p-0 text-xs"
    >
      <Icon name="lucide:link" size="12" />
      <span>Sources</span>
      <span class="ml-1 badge badge-soft badge-xs gap-1">
        {{ sources.length }}
      </span>
      <Icon
        name="lucide:chevron-right"
        class="text-base-content/60 transition-transform group-open:rotate-90"
      />
    </summary>
    <div
      :id="`sources-url-${message.id}-content`"
    >
      <div class="flex flex-wrap gap-2 pt-4 px-3">
        <button
          v-for="source in sources"
          :key="source.sourceId"
          type="button"
          class="link badge badge-soft badge-sm gap-1 no-underline"
          @click="openLink(source)"
        >
          <span class="max-w-32 truncate text-xs">{{ getLabel(source) }}</span>
        </button>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { UIMessage, SourceUrlUIPart } from 'ai'

const MAX_TITLE_LENGTH = 30

const props = defineProps<{
  message: UIMessage
}>()

const { allowExternalLinks, setAllowExternalLinks } = useUserSetting()

const sources = computed<SourceUrlUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'source-url'
  })
})

async function openLink(source: SourceUrlUIPart) {
  if (allowExternalLinks.value) {
    window.open(source.url, '_blank', 'noopener,noreferrer')

    return
  }

  const result = await useConfirm({
    text: `Open ${getLabel(source)}?`,
    subtitle: 'You are about to leave and open an external website. Make sure you trust this source before continuing.',
    actions: ['Open', 'Open always'],
    labelDecline: 'Close',
  })

  if (!result) return

  if (result.index === 1) {
    const alsoConfirmed = await useConfirm({
      text: 'Always open external links?',
      subtitle: 'All future links will open without asking. You can reset this in Settings.',
      actions: ['Yes, always'],
      labelDecline: 'No, just this once',
    })

    if (alsoConfirmed) {
      void setAllowExternalLinks(true)
    }
  }

  window.open(source.url, '_blank', 'noopener,noreferrer')
}

function getLabel(source: SourceUrlUIPart): string {
  if (source.title && source.title.length <= MAX_TITLE_LENGTH) {
    return source.title
  }

  try {
    return new URL(source.url).hostname.replace(/^www\./, '')
  } catch {
    return source.url
  }
}
</script>
