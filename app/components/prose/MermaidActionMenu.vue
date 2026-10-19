<template>
  <div class="contents">
    <details
      ref="dropdownRef"
      class="js-mermaid-action-menu dropdown dropdown-bottom dropdown-end group relative z-20 open:z-40"
      @toggle="onToggle"
      @keydown.esc="onEscape"
      @click="onDetailsClick"
    >
      <UiButton
        tag="summary"
        mode="default"
        ghost
        :icon-name="isCopied ? 'lucide:check' : icon"
        :icon-size="14"
        size="xs"
        :text="isCopied ? 'Copied!' : label"
        icon-only-phone
        :disabled="isTriggerDisabled"
        :aria-expanded="isOpen"
        :aria-disabled="isTriggerDisabled ? 'true' : undefined"
        :data-testid="testId"
      />
      <div ref="contentRef" class="dropdown-content z-50 w-44 pt-2">
        <ul
          tabindex="0"
          class="menu menu-sm bg-base-100 rounded-box shadow-lg w-44 p-1"
        >
          <li v-for="item in actions" :key="item.action">
            <button
              type="button"
              :disabled="isItemDisabled(item)"
              :data-testid="`mermaid-export-${item.action}`"
              @click="onAction(item.action)"
            >
              <Icon :name="item.icon" size="14" />
              {{ item.label }}
            </button>
          </li>
        </ul>
      </div>
    </details>
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-testid="mermaid-menu-status"
    >
      {{ announcement }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type {
  DiagramExportAction,
  DiagramMenuAction,
  DiagramMenuInput,
} from '~/types/diagram-export.d'

const props = defineProps<{
  label: string
  icon: string
  testId: string
  actions: DiagramMenuAction[]
  input: DiagramMenuInput
}>()

const FAILURE_MESSAGE: string = 'Couldn\'t export diagram'
const COPIED_MESSAGE: string = 'Copied'
const FEEDBACK_MS: number = 2000
const COPY_ACTION_PREFIX: string = 'copy-'
const MENU_EDGE_GAP_PX: number = 4

const { runExportAction } = useDiagramExport()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const contentRef = useTemplateRef<HTMLElement>('contentRef')
const isCopied = shallowRef<boolean>(false)
const isOpen = shallowRef<boolean>(false)
const announcement = shallowRef<string>('')

let feedbackTimer: ReturnType<typeof setTimeout> | null = null

function isItemDisabled(item: DiagramMenuAction): boolean {
  return item.needsSvg && !props.input.svg
}

const isTriggerDisabled = computed<boolean>(() => {
  return props.actions.every(isItemDisabled)
})

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

watch(isTriggerDisabled, (isDisabled) => {
  if (isDisabled) {
    closeDropdown()
  }
})

onBeforeUnmount(() => {
  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
  }
})

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
  }

  isOpen.value = false
}

function focusTrigger() {
  dropdownRef.value?.querySelector<HTMLElement>('summary')?.focus()
}

function getClippingBoundary(element: HTMLElement): DOMRect {
  let ancestor = element.parentElement

  while (ancestor) {
    const { overflowX } = getComputedStyle(ancestor)

    if (overflowX && overflowX !== 'visible') {
      return ancestor.getBoundingClientRect()
    }

    ancestor = ancestor.parentElement
  }

  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function keepMenuInsideBoundary() {
  const menu = dropdownRef.value
  const content = contentRef.value

  if (!menu || !content) {
    return
  }

  content.style.translate = ''

  const boundary = getClippingBoundary(menu)

  if (!boundary.width) {
    return
  }

  const left = menu.getBoundingClientRect().left + content.offsetLeft
  const right = left + content.offsetWidth
  const maxRight = boundary.right - MENU_EDGE_GAP_PX
  const minLeft = boundary.left + MENU_EDGE_GAP_PX
  let shift = right > maxRight ? maxRight - right : 0

  if (left + shift < minLeft) {
    shift = minLeft - left
  }

  if (shift) {
    content.style.translate = `${shift}px`
  }
}

function onToggle() {
  const currentMenu = dropdownRef.value

  isOpen.value = !!currentMenu?.open

  if (!currentMenu?.open) {
    return
  }

  keepMenuInsideBoundary()

  const openMenus = document.querySelectorAll<HTMLDetailsElement>(
    'details.js-mermaid-action-menu[open]',
  )

  openMenus.forEach((menu) => {
    if (menu !== currentMenu) {
      menu.open = false
    }
  })
}

function onEscape(event: KeyboardEvent) {
  if (!dropdownRef.value?.open) {
    return
  }

  event.preventDefault()
  closeDropdown()
  focusTrigger()
}

function onDetailsClick(event: MouseEvent) {
  const isTriggerClick = event.target instanceof Element
    && !!event.target.closest('summary')

  if (isTriggerClick && isTriggerDisabled.value) {
    event.preventDefault()
  }
}

function announce(message: string) {
  announcement.value = message

  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
  }

  feedbackTimer = setTimeout(() => {
    isCopied.value = false
    announcement.value = ''
    feedbackTimer = null
  }, FEEDBACK_MS)
}

function showCopiedFeedback() {
  isCopied.value = true
  announce(COPIED_MESSAGE)
}

function reportFailure() {
  useErrorMessage(FAILURE_MESSAGE)
  announce(FAILURE_MESSAGE)
}

async function reportOutcome(
  action: DiagramExportAction,
  outcome: boolean | Promise<boolean>,
) {
  const isSuccess = await outcome

  if (!isSuccess) {
    reportFailure()

    return
  }

  if (action.startsWith(COPY_ACTION_PREFIX)) {
    showCopiedFeedback()
  }
}

function onAction(action: DiagramExportAction) {
  const themeElement = props.input.themeElement()
  const item = props.actions.find(candidate => candidate.action === action)

  if (!item || isItemDisabled(item) || !themeElement) {
    closeDropdown()
    focusTrigger()
    reportFailure()

    return
  }

  const outcome = runExportAction(action, {
    source: props.input.source,
    svg: props.input.svg,
    themeElement,
  })

  closeDropdown()
  focusTrigger()
  reportOutcome(action, outcome)
}
</script>
