<template>
  <details
    v-if="canDownload"
    ref="menu"
    class="dropdown dropdown-end"
    data-testid="google-file-download"
    @keydown.esc="onEscape"
    @focusout="onFocusOut"
  >
    <summary
      class="btn btn-sm btn-soft max-sm:btn-square"
      title="Download"
      data-testid="google-file-download-trigger"
    >
      <Icon
        name="lucide:download"
        size="16"
        aria-hidden="true"
      />
      <span class="max-sm:sr-only">Download</span>
    </summary>
    <div
      class="dropdown-content z-50 w-64 pt-2"
      data-testid="google-file-download-menu"
      @mousedown.prevent
    >
      <ul class="menu menu-sm w-full rounded-box bg-base-100 p-1 shadow-lg">
        <li
          v-for="option in options"
          :key="option.format"
        >
          <a
            :href="getDownloadUrl(option.format)"
            download
            :class="{ 'pointer-events-none opacity-60': isCoolingDown }"
            :aria-disabled="isCoolingDown ? 'true' : undefined"
            :data-testid="`google-file-download-${option.format}`"
            @click="onItemClick($event, option.format)"
          >
            {{ option.label }}
          </a>
        </li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { GoogleCreatedFileKind } from '#shared/utils/google-created-file'
import {
  buildGoogleFileDownloadName,
  buildGoogleFileDownloadUrl,
  getGoogleFileDownloadOptions,
} from '#shared/utils/google-file-download'
import type { GoogleFileDownloadFormat } from '#shared/utils/google-file-download'

defineOptions({ inheritAttrs: false })

const COOLDOWN_MS = 1500

const props = defineProps<{
  kind: GoogleCreatedFileKind
  title: string
  fileId?: string
  chatSlug?: string
}>()

const { onDownloadClick } = useFileDownload()

const menu = useTemplateRef<HTMLDetailsElement>('menu')
const isCoolingDown = shallowRef<boolean>(false)
let cooldownTimer: ReturnType<typeof setTimeout> | null = null

const options = computed(() => {
  return getGoogleFileDownloadOptions(props.kind)
})

const canDownload = computed<boolean>(() => {
  return !!props.fileId && !!props.chatSlug && options.value.length > 0
})

function getDownloadUrl(format: GoogleFileDownloadFormat): string {
  return buildGoogleFileDownloadUrl({
    chatSlug: props.chatSlug ?? '',
    fileId: props.fileId ?? '',
    format,
  })
}

function closeMenu() {
  if (menu.value?.open) {
    menu.value.open = false
  }
}

function onEscape(event: KeyboardEvent) {
  if (!menu.value?.open) {
    return
  }

  event.preventDefault()
  closeMenu()
  menu.value.querySelector<HTMLElement>('summary')?.focus()
}

function onFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget

  if (!(nextTarget instanceof Node) || menu.value?.contains(nextTarget)) {
    return
  }

  closeMenu()
}

function startCooldown() {
  isCoolingDown.value = true
  cooldownTimer = setTimeout(() => {
    isCoolingDown.value = false
    cooldownTimer = null
  }, COOLDOWN_MS)
}

async function onItemClick(
  event: MouseEvent,
  format: GoogleFileDownloadFormat,
) {
  if (isCoolingDown.value) {
    event.preventDefault()

    return
  }

  startCooldown()
  closeMenu()

  await onDownloadClick(event, {
    url: getDownloadUrl(format),
    fileName: buildGoogleFileDownloadName(props.title, props.kind, format),
  })
}

onBeforeUnmount(() => {
  if (cooldownTimer) {
    clearTimeout(cooldownTimer)
  }
})
</script>
