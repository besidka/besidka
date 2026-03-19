<template>
  <Teleport
    v-if="anchorEl && messageId"
    :to="anchorEl"
  >
    <ul
      ref="menu"
      class="absolute z-[9999] menu menu-xs bg-base-100 rounded-xl shadow-lg border border-base-200 w-44 p-1"
      :class="{ invisible: !menuStyle }"
      :style="menuStyle"
      @pointerdown.stop
      @contextmenu.stop.prevent
    >
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
const props = defineProps<{
  messageId: string | null
  anchorEl: HTMLElement | null
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
