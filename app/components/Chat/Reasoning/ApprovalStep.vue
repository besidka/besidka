<template>
  <div
    role="group"
    class="min-w-0 flex-1 rounded-box outline-offset-2 focus:outline-2 focus:outline-accent"
    :class="isBubble ? 'js-tool-approval-step' : 'my-2.5'"
    :data-approval-id="model.approvalId"
    :data-state="state"
    :tabindex="isFocusable ? 0 : undefined"
    :aria-labelledby="titleId"
    :aria-describedby="state === 'denied' || isCompact ? undefined : reasonId"
    data-testid="reasoning-approval-step"
    @keydown.enter.self="onEnter"
    @keydown.esc="onEscape"
  >
    <p
      :id="titleId"
      class="min-w-0 break-words text-xs font-medium"
      data-testid="reasoning-approval-step-title"
    >
      <ChatReasoningStepIcon
        :icon="icon ?? null"
        class="mr-1.5"
      />{{ title }}
    </p>
    <p
      v-if="state === 'denied'"
      class="mt-0.5 text-xs text-base-content/60"
      data-testid="reasoning-approval-step-outcome"
    >
      {{ outcome }}
    </p>
    <p
      v-else-if="isCompact"
      class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-base-content/70"
      data-testid="reasoning-approval-step-waiting"
    >
      <span>{{ compactText }}</span>
      <button
        v-if="state === 'pending' && controller"
        type="button"
        class="btn btn-link btn-xs min-h-6 px-0 text-base-content/70"
        data-testid="reasoning-approval-step-review"
        @click="controller.focusApproval(model.approvalId)"
      >
        Review
      </button>
    </p>
    <template v-else>
      <p
        v-if="summaryLine"
        class="mt-0.5 min-w-0 break-words text-xs text-base-content/80"
        data-testid="reasoning-approval-step-summary"
      >
        {{ summaryLine }}
      </p>
      <p
        :id="reasonId"
        class="mt-0.5 min-w-0 break-words text-xs text-base-content/60"
        data-testid="reasoning-approval-step-reason"
      >
        {{ reasonText }}
      </p>
      <details
        v-if="clippedPreview.text"
        class="mt-1 text-xs"
        data-testid="reasoning-approval-step-preview"
      >
        <summary class="min-h-6 cursor-pointer leading-6 text-base-content/60">
          Text to save
          <span
            v-if="clippedPreview.isClipped"
            class="ml-1"
          >· Full text in View details</span>
        </summary>
        <p
          class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-2 text-xs"
          data-testid="reasoning-approval-step-preview-text"
        >{{ clippedPreview.text }}</p>
      </details>
      <details
        v-if="argumentsText"
        :open="isArgumentsOpen"
        class="mt-1 text-xs"
        data-testid="reasoning-approval-step-arguments"
        @toggle="onArgumentsToggle"
      >
        <summary
          class="min-h-6 cursor-pointer leading-6 text-base-content/60"
        >
          Arguments
          <span
            v-if="isShortened"
            class="ml-1"
            data-testid="reasoning-approval-step-shortened"
          >· Shown shortened</span>
        </summary>
        <pre
          class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-2 text-xs"
          data-testid="reasoning-approval-step-arguments-text"
        >{{ argumentsText }}</pre>
      </details>
      <div
        v-if="hasButtons"
        class="mt-2 flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center"
        data-testid="reasoning-approval-step-actions"
      >
        <button
          v-for="button in buttons"
          :key="button.remember"
          type="button"
          class="btn btn-sm max-md:w-full"
          :class="button.remember === 'once' ? 'btn-primary' : 'btn-soft'"
          :title="getButtonHint(button.remember)"
          :disabled="isBusy"
          :data-testid="`reasoning-approval-step-allow-${button.remember}`"
          @click="onAllow(button.remember)"
        >
          {{ button.label }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm max-md:w-full"
          :disabled="isBusy"
          data-testid="reasoning-approval-step-deny"
          @click="onDeny"
        >
          Deny
        </button>
      </div>
      <p
        v-if="state === 'sending'"
        class="mt-2 flex items-center gap-1.5 text-xs text-base-content/70"
        data-testid="reasoning-approval-step-sending"
      >
        <SvgoLoader class="size-3.5" />
        Sending your answer…
      </p>
      <div
        v-else-if="state === 'answered'"
        class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70"
        data-testid="reasoning-approval-step-answered"
      >
        <span>{{ answeredText }}</span>
        <button
          v-if="controller"
          type="button"
          class="btn btn-link btn-xs min-h-6 px-0 text-base-content/70"
          data-testid="reasoning-approval-step-change"
          @click="controller.change(model.approvalId)"
        >
          Change
        </button>
      </div>
      <div
        v-else-if="state === 'expired' || state === 'interrupted'"
        class="mt-2 flex flex-col gap-1.5 text-xs md:flex-row md:flex-wrap md:items-center"
        data-testid="reasoning-approval-step-failure"
      >
        <span class="text-base-content/70">{{ failureText }}</span>
        <button
          v-if="controller"
          type="button"
          class="btn btn-soft btn-sm max-md:w-full"
          data-testid="reasoning-approval-step-ask-again"
          @click="onAskAgain"
        >
          Ask again
        </button>
        <span
          v-if="isAskAgainHintVisible"
          class="text-base-content/60"
          data-testid="reasoning-approval-step-ask-again-hint"
        >
          Your message is back in the box. Send it to try again.
        </span>
      </div>
      <p
        v-if="outcome && state === 'approved'"
        class="mt-1 text-xs text-base-content/60"
        data-testid="reasoning-approval-step-outcome"
      >
        {{ outcome }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          v-if="progress"
          class="text-xs text-base-content/60"
          data-testid="reasoning-approval-step-progress"
        >
          {{ progress }}
        </p>
        <button
          type="button"
          class="btn btn-link btn-xs min-h-6 px-0 text-base-content/70"
          data-testid="reasoning-approval-step-details"
          @click="openDetails"
        >
          View details
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { LazyChatReasoningApprovalDetails } from '#components'
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'
import type { ToolApprovalRemember } from '#shared/utils/tool-approval-policy'
import type {
  ApprovalStepModel,
  ApprovalStepState,
} from '~/utils/tool-approval-step'
import {
  clipApprovalPreview,
  formatApprovalArguments,
  getApprovalButtons,
  getAlwaysAllowHint,
  isApprovalInputShortened,
} from '~/utils/tool-approval-step'

const props = withDefaults(defineProps<{
  model: ApprovalStepModel
  state: ApprovalStepState
  title: string
  reasonText: string
  summaryLine: string
  progress: string
  outcome: string
  messageId: string
  connectorName?: string
  icon?: ReasoningStepIcon | null
  variant?: 'bubble' | 'step'
  isInBubble?: boolean
}>(), {
  connectorName: '',
  icon: null,
  variant: 'bubble',
  isInBubble: false,
})

const CHAT_GRANT_HINT = 'Runs this tool without asking in later messages '
  + 'of this chat, also after content from earlier messages.'

const controller = useToolApprovalController()
const sidePanel = useSidePanel()

const isArgumentsOpen = shallowRef<boolean>(false)
const isSubmitting = shallowRef<boolean>(false)
const isAskAgainHintVisible = shallowRef<boolean>(false)

const idPrefix = computed<string>(() => {
  return `tool-approval-${props.variant}-${props.model.approvalId}`
})

const titleId = computed<string>(() => {
  return `${idPrefix.value}-title`
})

const reasonId = computed<string>(() => {
  return `${idPrefix.value}-reason`
})

function getButtonHint(remember: ToolApprovalRemember): string | undefined {
  if (remember === 'chat') {
    return CHAT_GRANT_HINT
  }

  return remember === 'always'
    ? getAlwaysAllowHint(props.model.isBesidka)
    : undefined
}

const isBubble = computed<boolean>(() => {
  return props.variant === 'bubble'
})

const isCompact = computed<boolean>(() => {
  return !isBubble.value && props.isInBubble
})

const compactText = computed<string>(() => {
  if (props.state === 'pending') {
    return 'Waiting for your approval below the message'
  }

  if (props.state === 'answered') {
    return 'Answered. Waiting for the other answers.'
  }

  if (props.state === 'sending') {
    return 'Sending your answer…'
  }

  return 'Could not finish. See below the message.'
})

const buttons = computed(() => {
  return getApprovalButtons(props.model.rememberOptions, props.model.toolName)
})

const hasButtons = computed<boolean>(() => {
  return isBubble.value
    && !!controller
    && (props.state === 'pending' || props.state === 'sending')
})

const isBusy = computed<boolean>(() => {
  return props.state === 'sending' || isSubmitting.value
})

const isFocusable = computed<boolean>(() => {
  return isBubble.value && !!controller && props.state === 'pending'
})

const argumentsText = computed<string>(() => {
  return formatApprovalArguments(props.model.input)
})

const clippedPreview = computed(() => {
  return clipApprovalPreview(props.model.preview)
})

const isShortened = computed<boolean>(() => {
  return isApprovalInputShortened(props.model, argumentsText.value)
})

const answeredText = computed<string>(() => {
  return props.model.approved === false
    ? 'You denied this. Waiting for the other answers.'
    : 'You allowed this. Waiting for the other answers.'
})

const failureText = computed<string>(() => {
  return props.state === 'interrupted'
    ? 'Interrupted before it finished.'
    : 'This approval expired.'
})

watch(() => props.state, () => {
  isSubmitting.value = false
})

async function onAllow(remember: ToolApprovalRemember) {
  if (!controller || isBusy.value) {
    return
  }

  isSubmitting.value = true

  try {
    await controller.answer({
      approvalId: props.model.approvalId,
      approved: true,
      remember,
    })
  } finally {
    isSubmitting.value = false
  }
}

async function onDeny() {
  if (!controller || isBusy.value) {
    return
  }

  isSubmitting.value = true

  try {
    await controller.answer({
      approvalId: props.model.approvalId,
      approved: false,
    })
  } finally {
    isSubmitting.value = false
  }
}

async function onAskAgain() {
  if (!controller) {
    return
  }

  await controller.askAgain(props.messageId)
  isAskAgainHintVisible.value = true
}

function onEnter(event: KeyboardEvent) {
  if (event.repeat || event.isComposing || props.state !== 'pending') {
    return
  }

  if (!props.model.rememberOptions.includes('once')) {
    return
  }

  event.preventDefault()
  onAllow('once')
}

function onEscape() {
  isArgumentsOpen.value = false
}

function onArgumentsToggle(event: Event) {
  isArgumentsOpen.value = (event.target as HTMLDetailsElement).open
}

function openDetails() {
  sidePanel.open({
    viewKey: `tool-approval:${props.model.approvalId}`,
    title: 'Approval details',
    mode: 'detail',
    component: LazyChatReasoningApprovalDetails,
    props: {
      title: props.title,
      toolName: props.model.toolName,
      summaryLine: props.summaryLine,
      reasonText: props.reasonText,
      input: props.model.input,
      isShortened: isShortened.value,
      preview: props.model.preview,
    },
  })
}
</script>
