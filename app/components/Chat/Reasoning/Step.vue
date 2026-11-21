<template>
  <li
    class="relative min-w-0"
    :class="step.approvalOutcome || step.grantMarker
      ? 'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2'
      : 'flex gap-2'
    "
  >
    <div
      class="relative flex w-5 shrink-0 items-start justify-center"
      :class="{
        'row-span-2': step.approvalOutcome || step.grantMarker,
      }"
    >
      <span
        v-if="!isFirst"
        aria-hidden="true"
        data-testid="reasoning-step-connector-top"
        class="
          absolute top-0 left-1/2 h-2 w-1 -translate-x-1/2 bg-base-100
        "
      />
      <span
        v-if="!isLast"
        aria-hidden="true"
        data-testid="reasoning-step-connector-bottom"
        class="
          absolute top-7 bottom-0 left-1/2 w-1 -translate-x-1/2
          bg-base-100
        "
      />
      <span
        class="
          relative z-10 mt-2 flex size-5 items-center justify-center
          rounded-full border border-base-100 bg-base-100
        "
      >
        <SvgoLoader
          v-if="step.pending"
          class="size-3.5 text-accent"
        />
        <span
          v-else-if="step.waiting"
          aria-hidden="true"
          class="reasoning-step-waiting"
        />
        <span
          v-else-if="step.failed"
          aria-hidden="true"
          class="reasoning-step-failed"
        />
        <span
          v-else
          aria-hidden="true"
          class="reasoning-step-complete"
        />
      </span>
    </div>
    <ChatReasoningApprovalStep
      v-if="step.approval"
      variant="step"
      :is-in-bubble="step.approval.isInBubble"
      :icon="step.icon"
      :model="step.approval.model"
      :state="step.approval.state"
      :title="step.title"
      :reason-text="step.approval.reasonText"
      :summary-line="step.approval.summaryLine"
      :progress="step.approval.progress"
      :outcome="step.approval.outcome"
      :message-id="messageId"
      :connector-name="step.approval.connectorName"
    />
    <ChatReasoningSearchStep
      v-else-if="step.search"
      :icon="step.icon"
      :data="step.search"
      :title="step.title"
      :pending="step.pending"
      :searched-at="searchedAt"
    />
    <ChatReasoningMemoryStep
      v-else-if="step.memory"
      :icon="step.icon"
      :data="step.memory"
      :title="step.title"
      :pending="step.pending"
    />
    <ChatReasoningSkillStep
      v-else-if="step.skill"
      :icon="step.icon"
      :data="step.skill"
      :title="step.title"
      :pending="step.pending"
    />
    <ChatReasoningConnectorStep
      v-else-if="step.connector"
      :icon="step.icon"
      :data="step.connector"
      :title="step.title"
      :pending="step.pending"
      :images="step.connectorImages ?? []"
      :connector-title="step.connectorTitle ?? ''"
    />
    <details
      v-else
      :open="isExpanded"
      class="group/point collapse my-2.5 min-w-0 flex-1"
    >
      <summary
        :aria-controls="step.body.length > 0 ? contentId : undefined"
        class="collapse-title flex min-w-0 items-center p-0 text-xs"
        @click.prevent="emit('toggle', step)"
      >
        <ChatReasoningStepIcon
          :icon="step.icon ?? null"
          class="mr-1.5"
        />
        <span
          :title="step.title"
          data-testid="reasoning-step-title"
          class="min-w-0"
          :class="[
            step.body.length > 0
              ? 'truncate'
              : 'break-words',
            step.pending
              ? 'skeleton skeleton-text reasoning-main-title-skeleton'
              : undefined,
          ]"
        >
          {{
            step.body.length > 0
              ? truncateReasoningTitle(step.title)
              : step.title
          }}
        </span>
        <Icon
          v-if="step.body.length > 0"
          name="lucide:chevron-right"
          class="
            ml-1 size-4 shrink-0 transition-transform
            group-open/point:rotate-90
          "
        />
      </summary>
      <div
        v-if="step.body.length > 0"
        :id="contentId"
        class="collapse-content mt-2 min-w-0 pb-0 px-0"
      >
        <MDCCached
          v-if="isExpanded"
          :key="bodyCacheKey"
          :cache-key="bodyCacheKey"
          :value="stripModelCitationMarkers(step.body)"
          :components="imageComponents"
          :parser-options="REASONING_PARSER_OPTIONS"
          class="chat-markdown text-xs !text-text/80"
        />
      </div>
    </details>
    <p
      v-if="step.approvalOutcome"
      class="col-start-2 -mt-2 mb-2.5 text-xs text-base-content/60"
      data-testid="reasoning-approval-outcome"
    >
      {{ step.approvalOutcome }}
    </p>
    <p
      v-if="step.grantMarker"
      class="col-start-2 -mt-2 mb-2.5 flex flex-wrap items-center gap-x-2 text-xs text-base-content/60"
      data-testid="reasoning-grant-marker"
    >
      <span>{{ step.grantMarker }}</span>
      <button
        v-if="canManageGrants"
        type="button"
        class="btn btn-link btn-xs min-h-6 px-0 text-base-content/70"
        aria-label="Manage remembered approvals in the chat panel"
        data-testid="reasoning-grant-manage"
        @click="emit('manage-grants')"
      >
        Manage
      </button>
    </p>
  </li>
</template>

<script setup lang="ts">
import type { MDCParseOptions } from '@nuxtjs/mdc'
import type { ReasoningStep } from '~/types/reasoning-step.d'

const props = defineProps<{
  step: ReasoningStep
  messageId: string
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  bodyCacheKey: string
  canManageGrants: boolean
  searchedAt?: string | number | Date
}>()

const emit = defineEmits<{
  'toggle': [step: ReasoningStep]
  'manage-grants': []
}>()

const REASONING_PARSER_OPTIONS: MDCParseOptions = { highlight: false }

const { imageComponents } = useChatFormat()

const contentId = computed<string>(() => {
  return `reasoning-${props.messageId}-${props.step.id}-content`
})
</script>

<style scoped>
.reasoning-step-complete {
  display: inline-flex;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 9999px;
  background-color: color-mix(
    in oklab,
    var(--color-accent) 20%,
    transparent
  );
}

.reasoning-step-waiting {
  display: inline-flex;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 9999px;
  background-color: color-mix(
    in oklab,
    var(--color-warning) 70%,
    transparent
  );
}

.reasoning-step-failed {
  display: inline-flex;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 9999px;
  background-color: color-mix(
    in oklab,
    var(--color-error) 20%,
    transparent
  );
}
</style>
