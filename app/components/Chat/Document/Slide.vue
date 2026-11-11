<template>
  <article
    class="grid gap-2"
    :aria-label="`Slide ${position} of ${total}: ${slide.title}`"
    data-testid="document-slide"
  >
    <div
      class="card aspect-video overflow-auto bg-base-200 p-4 text-sm"
      :class="isCentered ? 'items-center justify-center text-center' : ''"
      tabindex="0"
      data-testid="document-slide-card"
    >
      <h4
        class="font-semibold leading-snug break-words"
        :class="isCentered ? 'text-lg' : 'mb-2 text-base'"
      >
        {{ slide.title }}
      </h4>
      <p
        v-if="slide.subtitle"
        class="text-base-content/70 break-words"
      >
        {{ slide.subtitle }}
      </p>
      <ul
        v-if="slide.bullets && slide.bullets.length > 0"
        class="ms-5 grid list-disc gap-1"
        data-testid="document-slide-bullets"
      >
        <li
          v-for="(bullet, bulletIndex) in slide.bullets"
          :key="`bullet-${bulletIndex}`"
        >
          <ChatDocumentRuns :runs="bullet" />
        </li>
      </ul>
      <div
        v-if="slide.columns"
        class="grid grid-cols-2 gap-3"
        data-testid="document-slide-columns"
      >
        <ChatDocumentBlocks
          v-for="(column, columnIndex) in slide.columns"
          :key="`column-${columnIndex}`"
          :blocks="column"
        />
      </div>
      <p
        v-if="slide.image"
        class="flex items-center gap-2 rounded-box border border-dashed border-base-300 bg-base-100 p-3 text-xs text-base-content/70"
        data-testid="document-slide-image"
      >
        <Icon
          name="lucide:image"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <span class="break-words">Image: {{ slide.image.alt }}</span>
      </p>
    </div>
    <div
      v-if="slide.notes"
      class="grid gap-1"
    >
      <button
        type="button"
        class="btn btn-xs btn-ghost justify-start"
        :aria-expanded="isNotesOpen"
        :aria-controls="notesId"
        data-testid="document-slide-notes-toggle"
        @click="isNotesOpen = !isNotesOpen"
      >
        <Icon
          :name="isNotesOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'"
          size="14"
          aria-hidden="true"
        />
        {{ isNotesOpen ? 'Hide notes' : 'Show notes' }}
      </button>
      <p
        v-if="isNotesOpen"
        :id="notesId"
        class="rounded-box bg-base-200 p-2 text-xs whitespace-pre-wrap break-words"
        data-testid="document-slide-notes"
      >
        {{ slide.notes }}
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { Slide } from '@besidka/doc-renderer/spec'

const props = defineProps<{
  slide: Slide
  position: number
  total: number
}>()

const notesId = useId()
const isNotesOpen = shallowRef<boolean>(false)

const isCentered = computed<boolean>(() => {
  return props.slide.layout === 'title' || props.slide.layout === 'section'
})
</script>
