<template>
  <ChatMessage
    v-if="bubbleViews.length > 0"
    role="assistant"
    :any-selected="anySelected"
    class="js-tool-approval-message mt-3"
  >
    <section
      ref="bubbleRoot"
      class="js-tool-approval-bubble"
      :aria-labelledby="headingId"
      data-testid="tool-approval-bubble"
    >
      <p
        :id="headingId"
        class="mb-2 flex items-center gap-1.5 text-xs font-medium text-base-content/80"
        data-testid="tool-approval-bubble-heading"
      >
        <Icon
          name="lucide:shield-alert"
          class="size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        {{ heading }}
      </p>
      <ul class="flex flex-col divide-y divide-base-content/10">
        <li
          v-for="view in bubbleViews"
          :key="view.id"
          class="py-2 first:pt-0 last:pb-0"
        >
          <ChatReasoningApprovalStep
            variant="bubble"
            :icon="view.icon"
            :model="view.approval.model"
            :state="view.approval.state"
            :title="view.title"
            :reason-text="view.approval.reasonText"
            :summary-line="view.approval.summaryLine"
            :progress="view.approval.progress"
            :outcome="view.approval.outcome"
            :message-id="message.id"
            :connector-name="view.approval.connectorName"
          />
        </li>
      </ul>
    </section>
  </ChatMessage>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'

const props = withDefaults(defineProps<{
  message: UIMessage
  anySelected?: boolean
}>(), {
  anySelected: false,
})

const { controller, bubbleViews, pendingApprovalIds } = useMessageApprovals(
  () => props.message,
)
const bubbleRoot = useTemplateRef<HTMLElement>('bubbleRoot')
const isBubbleInView = useToolApprovalBubbleInView()
const scrollContainer = shallowRef<HTMLElement | null>(null)
const MIN_VISIBLE_HEIGHT_PX = 48
let inViewFrameId: number | null = null

/**
 * Whether enough of the bubble shows between the top of the chat scroll
 * container and the top of the composer, read on scroll and resize.
 */
function updateInView() {
  inViewFrameId = null

  const element = bubbleRoot.value

  if (!element) {
    isBubbleInView.value = false

    return
  }

  const rect = element.getBoundingClientRect()
  const visibleTop = scrollContainer.value?.getBoundingClientRect().top ?? 0
  const visibleBottom = document.querySelector<HTMLElement>(
    '.js-chat-composer',
  )?.getBoundingClientRect().top ?? window.innerHeight

  isBubbleInView.value = rect.top < visibleBottom - MIN_VISIBLE_HEIGHT_PX
    && rect.bottom > visibleTop + MIN_VISIBLE_HEIGHT_PX
}

function scheduleInViewUpdate() {
  if (inViewFrameId !== null) {
    return
  }

  inViewFrameId = requestAnimationFrame(updateInView)
}

watch(bubbleRoot, (element) => {
  scrollContainer.value = element?.closest<HTMLElement>(
    '.js-chat-scroll-container',
  ) ?? null
  scheduleInViewUpdate()
}, { flush: 'post' })

watch(bubbleViews, scheduleInViewUpdate, { flush: 'post' })

useEventListener(scrollContainer, 'scroll', scheduleInViewUpdate, {
  passive: true,
})
useEventListener('resize', scheduleInViewUpdate, { passive: true })
useResizeObserver(bubbleRoot, scheduleInViewUpdate)

onBeforeUnmount(() => {
  if (inViewFrameId !== null) {
    cancelAnimationFrame(inViewFrameId)
  }

  isBubbleInView.value = false
})

const headingId = computed<string>(() => {
  return `tool-approval-bubble-${props.message.id}`
})

const heading = computed<string>(() => {
  const count = pendingApprovalIds.value.length

  if (count > 0) {
    return count === 1
      ? 'Waiting for your approval'
      : `${count} actions waiting for your approval`
  }

  const sendingCount = bubbleViews.value.filter((view) => {
    return view.approval.state === 'sending'
  }).length

  if (sendingCount === 0) {
    return 'This approval could not finish'
  }

  return sendingCount === 1 ? 'Sending your answer' : 'Sending your answers'
})

watch(() => controller?.focusRequest.value, async (request) => {
  if (!request || !pendingApprovalIds.value.includes(request.approvalId)) {
    return
  }

  await nextTick()

  const step = bubbleRoot.value?.querySelector<HTMLElement>(
    `.js-tool-approval-step[data-approval-id="${CSS.escape(request.approvalId)}"]`,
  )

  if (!step) {
    return
  }

  step.scrollIntoView({ block: 'center', behavior: 'smooth' })
  step.focus({ preventScroll: true })
})
</script>
