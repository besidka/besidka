<template>
  <section
    class="grid gap-3 rounded-box border border-warning/40 p-3"
    :aria-labelledby="headingId"
    data-testid="connector-tool-review"
  >
    <div
      class="alert alert-warning alert-soft items-start"
      role="status"
    >
      <Icon
        name="lucide:triangle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <div class="grid gap-1">
        <h3
          :id="headingId"
          class="font-medium"
        >
          {{ isFirstReview ? 'Review the tools' : 'Tools changed' }}
        </h3>
        <p class="text-sm">
          {{ intro }}
        </p>
      </div>
    </div>

    <ul
      class="grid gap-3"
      data-testid="connector-tool-review-list"
    >
      <li
        v-for="tool in visibleTools"
        :key="tool.name"
        class="grid gap-1"
        data-testid="connector-tool-review-item"
        :data-tool-name="tool.name"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="break-words font-medium">
            {{ tool.title || tool.name }}
          </span>
          <span
            v-if="tool.change !== 'new'"
            class="badge badge-soft badge-sm"
            :class="tool.change === 'added' ? 'badge-info' : 'badge-warning'"
            data-testid="connector-tool-review-change"
          >
            {{ tool.change === 'added' ? 'New tool' : 'Changed' }}
          </span>
          <ProfileConnectorsToolBadges :tool="tool" />
        </div>
        <p
          v-if="tool.title && tool.title !== tool.name"
          class="break-all font-mono text-xs text-base-content/70"
        >
          {{ tool.name }}
        </p>
        <p
          class="whitespace-pre-line break-words text-sm text-base-content/80"
          data-testid="connector-tool-review-description"
        >
          {{ tool.description || 'No description.' }}
        </p>
      </li>
    </ul>
    <button
      v-if="hiddenCount > 0"
      type="button"
      class="link link-hover justify-self-start text-sm"
      data-testid="connector-tool-review-show-all"
      @click="isShowingAll = true"
    >
      Show all {{ tools.length }} tools
    </button>

    <p
      v-if="removed.length"
      class="text-sm text-base-content/70"
      data-testid="connector-tool-review-removed"
    >
      No longer listed: {{ removed.join(', ') }}
    </p>

    <div class="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        class="btn btn-sm min-h-11 sm:min-h-8"
        :disabled="isBusy"
        data-testid="connector-tool-review-keep"
        @click="emit('decide', 'keep-disabled')"
      >
        Keep disabled
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary min-h-11 sm:min-h-8"
        :disabled="isBusy"
        data-testid="connector-tool-review-accept"
        @click="emit('decide', 'accept')"
      >
        {{ isFirstReview ? 'Turn on these tools' : 'Accept changes' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ConnectorReviewTool } from '#shared/types/connectors.d'

const COLLAPSED_TOOL_COUNT = 20

const props = withDefaults(defineProps<{
  tools: ConnectorReviewTool[]
  removed: string[]
  isFirstReview: boolean
  isBusy?: boolean
}>(), {
  isBusy: false,
})

const emit = defineEmits<{
  decide: [decision: 'accept' | 'keep-disabled']
}>()

const headingId = useId()
const isShowingAll = shallowRef<boolean>(false)

const visibleTools = computed<ConnectorReviewTool[]>(() => {
  return isShowingAll.value
    ? props.tools
    : props.tools.slice(0, COLLAPSED_TOOL_COUNT)
})

const hiddenCount = computed<number>(() => {
  return props.tools.length - visibleTools.value.length
})

const intro = computed<string>(() => {
  if (props.isFirstReview) {
    return 'This is what the server says its tools do. Read it before the '
      + 'model can use them. Every tool that changes data asks you first.'
  }

  return 'The server changed what its tools say they do. The changed tools '
    + 'are hidden from chats until you accept them. Besidka does not keep '
    + 'the old wording, so this shows the current one. An Always allow '
    + 'given before does not carry over.'
})
</script>
