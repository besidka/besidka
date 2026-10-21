<template>
  <details
    v-if="omittedContext"
    class="group collapse mb-2"
    data-testid="omitted-context-files"
  >
    <summary
      :id="`omitted-context-files-${message.id}-label`"
      :aria-controls="`omitted-context-files-${message.id}-content`"
      class="
        collapse-title flex items-center gap-1 p-0 text-xs
        text-base-content/70
      "
    >
      <Icon name="lucide:paperclip" size="12" />
      <span>{{ summary }}</span>
      <Icon
        name="lucide:chevron-right"
        class="text-base-content/60 transition-transform group-open:rotate-90"
      />
    </summary>
    <div
      :id="`omitted-context-files-${message.id}-content`"
      class="pt-2 px-3 text-xs"
    >
      <ul class="flex flex-col gap-1">
        <li
          v-for="(file, index) in omittedContext.files"
          :key="`omitted-file-${message.id}-${index}`"
          class="flex flex-wrap items-baseline gap-x-2"
          data-testid="omitted-context-file"
        >
          <span class="max-w-48 truncate">
            {{ getOmittedContextFileName(file) }}
          </span>
          <span class="text-base-content/60">
            {{ getModelContextOmissionLabel(
              file.reason,
              omittedContext.modelName,
            ) }}
          </span>
        </li>
      </ul>
      <p class="mt-2 text-base-content/60">
        Attach a file again to include it.
      </p>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  getModelContextOmissionLabel,
  getOmittedContextFileName,
  getOmittedContextFiles,
  getOmittedContextFilesSummary,
} from '#shared/utils/model-context-omissions'

const props = defineProps<{
  message: UIMessage
}>()

const omittedContext = computed(() => {
  return getOmittedContextFiles(props.message)
})

const summary = computed<string>(() => {
  return getOmittedContextFilesSummary(
    omittedContext.value?.files.length ?? 0,
  )
})
</script>
