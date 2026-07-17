<template>
  <Teleport
    v-if="anchorEl && messageId"
    :to="anchorEl"
  >
    <ul
      ref="menu"
      class="absolute z-[9999] menu menu-xs bg-base-100 rounded-xl shadow-lg border border-base-200 w-64 p-1 select-none overflow-y-auto overscroll-contain transition-[opacity,visibility] duration-200"
      :class="{
        invisible: !menuStyle || isTextSelecting,
        'opacity-0': isTextSelecting,
      }"
      :style="menuStyle"
      @pointerdown.stop
      @contextmenu.stop.prevent
    >
      <template v-if="info">
        <li>
          <div
            data-testid="message-menu-info"
            class="menu-title flex flex-col gap-1 !p-2 cursor-default"
          >
            <div
              v-if="dateTimeInfo.date"
              data-testid="message-menu-datetime"
              class="text-right text-xs font-normal text-base-content/50"
            >
              {{ dateTimeInfo.date }} · {{ dateTimeInfo.time }}
            </div>
            <div
              v-if="info.model"
              data-testid="message-menu-model"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Model</span>
              <span
                class="min-w-0 truncate font-normal text-base-content"
                :title="info.model"
              >
                {{ modelDisplayName }}
              </span>
            </div>
            <div
              v-if="info.reasoning && info.reasoning !== 'off'"
              data-testid="message-menu-reasoning"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Reasoning</span>
              <span class="flex min-w-0 flex-wrap items-center justify-end gap-1.5 font-normal text-base-content">
                <span
                  v-if="info.reasoningTokens !== undefined"
                  class="text-base-content/50"
                >
                  ({{ formatTokenCount(info.reasoningTokens) }} tokens)
                </span>
                <component :is="reasoningIconName" class="size-3.5 shrink-0" />
                <span class="capitalize">{{ info.reasoning }}</span>
              </span>
            </div>
            <div
              v-if="toolsLabel"
              data-testid="message-menu-tools"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Tools</span>
              <span class="flex min-w-0 flex-wrap items-center justify-end gap-1.5 font-normal text-base-content">
                <Icon :name="toolsIconName" size="14" class="shrink-0" />
                {{ toolsLabel }}
              </span>
            </div>
            <div
              v-if="info.tokens !== undefined"
              data-testid="message-menu-tokens"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">
                {{ tokensLabel }}
              </span>
              <span class="min-w-0 truncate font-normal text-base-content">
                {{ formatTokenCount(info.tokens) }}
              </span>
            </div>
            <div
              v-if="hasCostInfo"
              class="flex flex-col gap-1"
            >
              <span class="text-xs font-normal text-base-content/50">
                Cost
              </span>
              <div
                v-if="info.cost !== undefined"
                data-testid="message-menu-cost-current"
                class="flex items-center justify-between gap-3 pl-2 text-xs"
              >
                <span class="shrink-0 font-normal text-base-content/50">
                  Current message
                </span>
                <span class="min-w-0 truncate font-normal text-base-content">
                  {{ formatMessageCost(info.cost) }}
                </span>
              </div>
              <div
                v-if="info.costToMessage !== undefined"
                data-testid="message-menu-cost-to-message"
                class="flex items-center justify-between gap-3 pl-2 text-xs"
              >
                <span class="shrink-0 font-normal text-base-content/50">
                  Up to this message
                </span>
                <span class="min-w-0 truncate font-normal text-base-content">
                  {{ formatMessageCost(info.costToMessage) }}
                </span>
              </div>
              <div
                v-if="info.chatTotalCost !== undefined"
                data-testid="message-menu-cost-chat-total"
                class="flex items-center justify-between gap-3 pl-2 text-xs"
              >
                <span class="shrink-0 font-normal text-base-content/50">
                  Chat total
                </span>
                <span class="min-w-0 truncate font-normal text-base-content">
                  {{ formatMessageCost(info.chatTotalCost) }}
                </span>
              </div>
            </div>
          </div>
        </li>
      </template>
      <li
        v-if="info && showBranch"
        aria-hidden="true"
        class="pointer-events-none"
      >
        <hr class="border-base-200 !p-0 mt-1 mb-2">
      </li>
      <li v-if="showBranch">
        <button
          type="button"
          @click="onBranch"
        >
          <Icon name="lucide:git-branch-plus" size="14" />
          Branch chat from here
        </button>
      </li>
      <li
        v-if="hasCopyText && (info || showBranch)"
        aria-hidden="true"
        class="pointer-events-none"
      >
        <hr
          class="border-base-200 !p-0"
          :class="showBranch ? 'my-2' : 'mt-1 mb-2'"
        >
      </li>
      <template v-if="hasCopyText">
        <li>
          <button
            type="button"
            data-testid="message-menu-copy"
            @click="onCopy"
          >
            <Icon :name="copyIconName" size="14" />
            {{ copyLabel }}
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="message-menu-copy-markdown"
            @click="onCopyMarkdown"
          >
            <Icon :name="copyMarkdownIconName" size="14" />
            {{ copyMarkdownLabel }}
          </button>
        </li>
      </template>
    </ul>
  </Teleport>
</template>

<script setup lang="ts">
import type { MessageMenuInfo } from '#shared/utils/message-metadata'
import type { ModelTool } from '#shared/types/providers.d'
import { markdownToPlainText } from '#shared/utils/markdown-plain'
import {
  formatMessageCost,
  formatMessageDateTime,
  formatTokenCount,
} from '#shared/utils/message-format'

const TOOL_LABELS: Record<ModelTool | 'deep_research', string> = {
  web_search: 'Web search',
  image_generation: 'Image generation',
  deep_research: 'Deep research',
}

const props = withDefaults(defineProps<{
  messageId: string | null
  anchorEl: HTMLElement | null
  info?: MessageMenuInfo | null
  pointer?: { x: number, y: number } | null
  showBranch?: boolean
  copyText?: string | null
}>(), {
  info: null,
  pointer: null,
  showBranch: true,
  copyText: null,
})

const emit = defineEmits<{
  branch: [messageId: string]
  close: []
}>()

const menu = useTemplateRef<HTMLUListElement>('menu')
let pointerDownTime = 0

const menuStyle = shallowRef<Record<string, string> | null>(
  null,
)
const isTextSelecting = shallowRef<boolean>(false)

const dateTimeInfo = computed(() => {
  return formatMessageDateTime(props.info?.createdAt)
})

const modelDisplayName = computed<string>(() => {
  if (!props.info?.model) {
    return ''
  }

  const { model } = getModel(props.info.model)

  return model ? getModelName(props.info.model) : props.info.model
})

const reasoningIconName = computed<string>(() => {
  const level = props.info?.reasoning ?? 'off'

  return `SvgoThink${level.charAt(0).toUpperCase()}${level.slice(1)}`
})

const toolsLabel = computed<string>(() => {
  if (!props.info?.usedTools?.length) {
    return ''
  }

  return props.info.usedTools
    .map(tool => TOOL_LABELS[tool])
    .join(', ')
})

const toolsIconName = computed<string>(() => {
  if (props.info?.usedTools?.includes('deep_research')) {
    return 'lucide:telescope'
  }

  if (props.info?.usedTools?.includes('image_generation')) {
    return 'lucide:image-plus'
  }

  return 'lucide:globe'
})

const tokensLabel = computed<string>(() => {
  return props.info?.role === 'user'
    ? 'Tokens (input)'
    : 'Tokens (output)'
})

const hasCostInfo = computed<boolean>(() => {
  return (
    props.info?.cost !== undefined
    || props.info?.costToMessage !== undefined
    || props.info?.chatTotalCost !== undefined
  )
})

const bubbleEl = computed<HTMLElement | null>(() => {
  if (!props.anchorEl) return null

  return props.anchorEl.querySelector<HTMLElement>('.js-chat-bubble')
    ?? props.anchorEl
})

const hasCopyText = computed<boolean>(() => {
  return typeof props.copyText === 'string' && props.copyText.length > 0
})

function useCopiedState() {
  const justCopied = shallowRef<boolean>(false)
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  function trigger() {
    justCopied.value = true

    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      justCopied.value = false
      timeoutId = null
    }, 2000)
  }

  function reset() {
    justCopied.value = false

    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return { justCopied, trigger, reset }
}

const richCopyState = useCopiedState()
const markdownCopyState = useCopiedState()

const copyIconName = computed<string>(() => {
  return richCopyState.justCopied.value ? 'lucide:check' : 'lucide:copy'
})

const copyLabel = computed<string>(() => {
  return richCopyState.justCopied.value ? 'Copied!' : 'Copy'
})

const copyMarkdownIconName = computed<string>(() => {
  return markdownCopyState.justCopied.value
    ? 'lucide:check'
    : 'lucide:file-code'
})

const copyMarkdownLabel = computed<string>(() => {
  return markdownCopyState.justCopied.value
    ? 'Copied!'
    : 'Copy as Markdown'
})

const { copyRich, copyPlain } = useMessageCopy()

function extractRenderedHtml(): string {
  const nodes = bubbleEl.value?.querySelectorAll<HTMLElement>(
    '.js-message-text',
  )

  if (!nodes || nodes.length === 0) {
    return ''
  }

  return Array.from(nodes).map(node => node.innerHTML).join('\n')
}

async function onCopy() {
  if (!props.copyText) return

  const succeeded = await copyRich({
    html: extractRenderedHtml(),
    text: markdownToPlainText(props.copyText),
  })

  if (!succeeded) {
    useErrorMessage('Failed to copy message')

    return
  }

  richCopyState.trigger()
}

async function onCopyMarkdown() {
  if (!props.copyText) return

  const succeeded = await copyPlain(props.copyText)

  if (!succeeded) {
    useErrorMessage('Failed to copy message')

    return
  }

  markdownCopyState.trigger()
}

onMounted(async () => {
  await nextTick()

  if (!props.anchorEl || !menu.value) return

  const anchorRect = props.anchorEl.getBoundingClientRect()
  const bubbleRect
    = (bubbleEl.value ?? props.anchorEl).getBoundingClientRect()
  const menuHeight = menu.value.offsetHeight
  const gap = 4
  const edgeMargin = 16
  const right = anchorRect.right - bubbleRect.right
  const spaceBelow
    = window.innerHeight - bubbleRect.bottom

  if (spaceBelow >= menuHeight + gap + edgeMargin) {
    menuStyle.value = {
      top: `${bubbleRect.bottom - anchorRect.top + gap}px`,
      right: `${right}px`,
      maxHeight: `${spaceBelow - gap - edgeMargin}px`,
    }

    return
  }

  if (bubbleRect.top >= menuHeight + gap + edgeMargin) {
    menuStyle.value = {
      bottom: `${anchorRect.bottom - bubbleRect.top + gap}px`,
      right: `${right}px`,
      maxHeight: `${bubbleRect.top - gap - edgeMargin}px`,
    }

    return
  }

  const desiredTop = props.pointer
    ? props.pointer.y + gap
    : window.innerHeight - menuHeight - edgeMargin
  const clampedTop = Math.max(
    edgeMargin,
    Math.min(
      Math.max(desiredTop, edgeMargin),
      window.innerHeight - menuHeight - edgeMargin,
    ),
  )
  const availableHeight = window.innerHeight - edgeMargin - clampedTop
  const menuWidth = menu.value.offsetWidth
  const bubbleWidth = bubbleRect.right - bubbleRect.left

  if (props.pointer && bubbleWidth >= menuWidth) {
    const desiredLeft = props.pointer.x
    const clampedLeft = Math.min(
      Math.max(desiredLeft, bubbleRect.left),
      bubbleRect.right - menuWidth,
    )

    menuStyle.value = {
      top: `${clampedTop - anchorRect.top}px`,
      left: `${clampedLeft - anchorRect.left}px`,
      maxHeight: `${availableHeight}px`,
    }

    return
  }

  menuStyle.value = {
    top: `${clampedTop - anchorRect.top}px`,
    right: `${right}px`,
    maxHeight: `${availableHeight}px`,
  }
})

function dismiss() {
  emit('close')
}

function onBranch() {
  if (!props.messageId) return

  emit('branch', props.messageId)
  emit('close')
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    dismiss()
  }
}

function onDocumentPointerDown() {
  pointerDownTime = Date.now()
}

function onDocumentPointerUp(event: PointerEvent) {
  const elapsed = Date.now() - pointerDownTime

  if (elapsed > 300) return

  const target = event.target as HTMLElement

  if (menu.value?.contains(target)) return
  if (bubbleEl.value?.contains(target)) return

  event.preventDefault()
  event.stopImmediatePropagation()
  swallowNextClick()
  dismiss()
}

function swallowNextClick() {
  const handler = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  document.addEventListener('click', handler, {
    capture: true,
    once: true,
  })

  setTimeout(() => {
    document.removeEventListener('click', handler, { capture: true })
  }, 100)
}

function onDocumentContextMenu(event: Event) {
  const target = event.target as HTMLElement

  if (bubbleEl.value?.contains(target)) return

  dismiss()
}

function onSelectionChange() {
  const selection = window.getSelection()

  isTextSelecting.value = !!selection && !selection.isCollapsed
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('pointerup', onDocumentPointerUp)
  document.addEventListener('contextmenu', onDocumentContextMenu)
  document.addEventListener('selectionchange', onSelectionChange)
  onSelectionChange()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('pointerup', onDocumentPointerUp)
  document.removeEventListener('contextmenu', onDocumentContextMenu)
  document.removeEventListener('selectionchange', onSelectionChange)
  richCopyState.reset()
  markdownCopyState.reset()
})
</script>
