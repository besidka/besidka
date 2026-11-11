<template>
  <div class="contents">
    <button
      type="button"
      data-testid="artifact-report-button"
      class="btn btn-ghost btn-sm min-h-6"
      aria-haspopup="dialog"
      @click="openReport"
    >
      <Icon
        name="lucide:flag"
        size="14"
        aria-hidden="true"
      />
      Report
    </button>
    <LazyArtifactReportModal
      v-if="hasOpened"
      v-model:open="isOpen"
      :title="title"
      :endpoint="endpoint"
      :version="version"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  shareSlug: string
  artifactId: string
  title: string
  version?: number | null
}>()

const isOpen = shallowRef<boolean>(false)
const hasOpened = shallowRef<boolean>(false)

function openReport() {
  hasOpened.value = true
  isOpen.value = true
}

const endpoint = computed<string>(() => {
  return `/api/v1/shared/${encodeURIComponent(props.shareSlug)}/artifacts/`
    + `${encodeURIComponent(props.artifactId)}/report`
})
</script>
