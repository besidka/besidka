<template>
  <article
    class="max-w-3xl mx-auto w-full px-3 sm:px-6 py-10 flex flex-col gap-6"
  >
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl sm:text-4xl font-black text-base-content">
        {{ doc?.title }}
      </h1>

      <p v-if="doc?.updatedAt" class="text-sm opacity-70">
        Last updated
        <time :datetime="doc.updatedAt">{{ formattedUpdatedAt }}</time>
      </p>
    </header>

    <aside
      v-if="doc?.summary"
      class="rounded-box bg-base-200/60 border border-base-300 p-4
        flex flex-col gap-1"
    >
      <p class="text-xs font-black uppercase tracking-wide opacity-70">
        In short
      </p>
      <p class="text-sm">
        {{ doc.summary }}
      </p>
    </aside>

    <ContentRenderer
      v-if="doc"
      :value="doc"
      :data="{ privacyEmail }"
      tag="div"
      class="prose prose-sm sm:prose-base max-w-none
        prose-headings:scroll-mt-24"
    />
  </article>
</template>

<script setup lang="ts">
import type { LegalCollectionItem } from '@nuxt/content'

const { doc } = defineProps<{ doc?: LegalCollectionItem | null }>()

// Reaches the markdown as {{ privacyEmail }} via ContentRenderer's `data`.
const { privacyEmail } = useRuntimeConfig().public

const formattedUpdatedAt = computed<string>(() => {
  if (!doc?.updatedAt) {
    return ''
  }

  const parsed = new Date(doc.updatedAt)

  if (Number.isNaN(parsed.getTime())) {
    return doc.updatedAt
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
})
</script>
