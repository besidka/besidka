<template>
  <Teleport
    v-if="anchorEl && messageId"
    :to="anchorEl"
  >
    <ul
      ref="menu"
      class="absolute z-[9999] menu menu-xs bg-base-100 rounded-xl shadow-lg border border-base-200 w-64 p-1"
      :class="{ invisible: !menuStyle }"
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
              <span class="min-w-0 truncate font-normal text-base-content">
                {{ info.model }}
              </span>
            </div>
            <div
              v-if="info.reasoning && info.reasoning !== 'off'"
              data-testid="message-menu-reasoning"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Reasoning</span>
              <span class="flex min-w-0 flex-wrap items-center justify-end gap-1.5 font-normal text-base-content">
                <component :is="reasoningIconName" class="size-3.5 shrink-0" />
                <span class="capitalize">{{ info.reasoning }}</span>
                <span
                  v-if="info.reasoningTokens !== undefined"
                  class="text-base-content/50"
                >
                  ({{ formatTokenCount(info.reasoningTokens) }} tokens)
                </span>
              </span>
            </div>
            <div
              v-if="toolsLabel"
              data-testid="message-menu-tools"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Tools</span>
              <span class="flex min-w-0 flex-wrap items-center justify-end gap-1.5 font-normal text-base-content">
                <Icon name="lucide:globe" size="14" class="shrink-0" />
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
              v-if="info.cost !== undefined"
              data-testid="message-menu-cost"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">Cost</span>
              <span class="min-w-0 truncate font-normal text-base-content">
                {{ formatMessageCost(info.cost) }}
              </span>
            </div>
            <div
              v-if="info.turnTotalCost !== undefined"
              data-testid="message-menu-turn-total"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="shrink-0 font-normal text-base-content/50">
                Turn total
              </span>
              <span class="min-w-0 truncate font-normal text-base-content">
                {{ formatMessageCost(info.turnTotalCost) }}
              </span>
            </div>
          </div>
        </li>
        <li
          aria-hidden="true"
          class="pointer-events-none"
        >
          <hr class="my-1 border-base-200">
        </li>
      </template>
      <li>
        <button
          type="button"
          @click="onBranch"
        >
          <Icon name="lucide:git-branch-plus" size="14" />
          New chat from here
        </button>
      </li>
    </ul>
  </Teleport>
</template>

<script setup lang="ts">
import type { MessageMenuInfo } from '#shared/utils/message-metadata'
import {
  formatMessageCost,
  formatMessageDateTime,
  formatTokenCount,
} from '#shared/utils/message-format'

const TOOL_LABELS: Record<'web_search', string> = {
  web_search: 'Web search',
}

const props = defineProps<{
  messageId: string | null
  anchorEl: HTMLElement | null
  info?: MessageMenuInfo | null
}>()

const emit = defineEmits<{
  branch: [messageId: string]
  close: []
}>()

const menu = useTemplateRef<HTMLUListElement>('menu')
let pointerDownTime = 0

const menuStyle = shallowRef<Record<string, string> | null>(
  null,
)

const dateTimeInfo = computed(() => {
  return formatMessageDateTime(props.info?.createdAt)
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

const tokensLabel = computed<string>(() => {
  return props.info?.role === 'user'
    ? 'Tokens (input)'
    : 'Tokens (output)'
})

onMounted(async () => {
  await nextTick()

  if (!props.anchorEl || !menu.value) return

  const anchorRect = props.anchorEl.getBoundingClientRect()
  const bubbleEl
    = props.anchorEl.querySelector<HTMLElement>(
      '.js-chat-bubble',
    )
  const bubbleRect
    = (bubbleEl ?? props.anchorEl).getBoundingClientRect()
  const menuHeight = menu.value.offsetHeight
  const gap = 4
  const right = anchorRect.right - bubbleRect.right
  const spaceBelow
    = window.innerHeight - bubbleRect.bottom

  if (spaceBelow >= menuHeight + gap + 16) {
    menuStyle.value = {
      top: `${bubbleRect.bottom - anchorRect.top + gap}px`,
      right: `${right}px`,
    }

    return
  }

  menuStyle.value = {
    bottom: `${anchorRect.bottom - bubbleRect.top + gap}px`,
    right: `${right}px`,
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
  if (props.anchorEl?.contains(target)) return

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

  if (props.anchorEl?.contains(target)) return

  dismiss()
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('pointerup', onDocumentPointerUp)
  document.addEventListener('contextmenu', onDocumentContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('pointerup', onDocumentPointerUp)
  document.removeEventListener('contextmenu', onDocumentContextMenu)
})
</script>
