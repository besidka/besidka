<template>
  <div class="w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24 mb-3">
    <UiBubble class="!block border border-base-300/70">
      <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
        {{
          instructions
            ? 'Project instructions'
            : 'Project context'
        }}
      </div>
      <div class="mt-1 text-sm font-medium">
        {{ projectName || 'Project' }}
      </div>
      <p
        v-if="instructions"
        class="mt-2 whitespace-pre-wrap text-sm leading-6"
        :class="{
          'line-clamp-6': shouldCollapseInstructions && !showFullInstructions,
        }"
      >
        {{ instructions }}
      </p>
      <button
        v-if="shouldCollapseInstructions"
        type="button"
        class="btn btn-ghost btn-xs mt-2"
        @click="showFullInstructions = !showFullInstructions"
      >
        {{ showFullInstructions ? 'Show less' : 'Show more' }}
      </button>
      <div
        v-if="memory"
        class="mt-4 border-t border-base-300/70 pt-4"
      >
        <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
          Project memory
        </div>
        <p
          class="mt-2 whitespace-pre-wrap text-sm leading-6"
          :class="{
            'line-clamp-6': shouldCollapseMemory && !showFullMemory,
          }"
        >
          {{ memory }}
        </p>
        <button
          v-if="shouldCollapseMemory"
          type="button"
          class="btn btn-ghost btn-xs mt-2"
          @click="showFullMemory = !showFullMemory"
        >
          {{ showFullMemory ? 'Show less' : 'Show more' }}
        </button>
      </div>
    </UiBubble>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  projectName: string | null
  instructions?: string | null
  memory?: string | null
}>()

const COLLAPSE_LENGTH = 280
const COLLAPSE_LINES = 6

const showFullInstructions = shallowRef<boolean>(false)
const showFullMemory = shallowRef<boolean>(false)

const shouldCollapseInstructions = computed(() => {
  return shouldCollapseText(props.instructions)
})

const shouldCollapseMemory = computed(() => {
  return shouldCollapseText(props.memory)
})

function shouldCollapseText(value?: string | null) {
  if (!value) {
    return false
  }

  const lineCount = value.split('\n').length

  return value.length > COLLAPSE_LENGTH || lineCount > COLLAPSE_LINES
}
</script>
