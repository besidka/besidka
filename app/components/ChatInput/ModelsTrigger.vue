<template>
  <div
    ref="root"
    class="relative"
  >
    <button
      ref="trigger"
      type="button"
      aria-label="Select model"
      data-testid="current-model-trigger"
      class="btn btn-ghost btn-sm rounded-full [--size:calc(var(--size-field)_*_6)] transition-colors duration-200 max-xxs:max-w-40"
      :class="{ 'btn-active': isOpen }"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      @click="toggle"
    >
      <ProviderIcon
        v-if="selectedIconProviderId"
        :provider-id="selectedIconProviderId"
        class="!size-4 text-base-content/40"
      />
      <span class="block truncate text-left min-w-0">
        {{ selectedModelName }}
      </span>
      <Icon
        name="lucide:chevron-down"
        size="14"
        :class="{ 'scale-y-[-1]': isOpen }"
      />
    </button>
    <ClientOnly>
      <Transition
        enter-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        leave-active-class="transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-bottom"
        enter-from-class="opacity-0 scale-95"
        leave-to-class="opacity-0 scale-95"
        @after-leave="resetTransientState"
      >
        <div
          v-if="hasOpened"
          v-show="isOpen"
          :id="panelId"
          data-testid="models-picker-panel"
          class="absolute bottom-full left-0 z-50 mb-2 w-[min(30rem,calc(100vw-4rem))]"
        >
          <ChatInputModelsTriggerPanel
            ref="panel"
            :is-open="isOpen"
            :selected-model-id="selectedModelId"
            :selected-gateway-id="selectedGatewayId"
            @select="onSelect"
            @close="onClose"
          />
        </div>
      </Transition>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import type { GatewayId } from '#shared/types/gateways.d'

interface PanelHandle {
  prepareOpen: () => Promise<void>
  resetTransientState: () => void
}

const { selection } = useUserModel()
const {
  name: selectedModelName,
  iconProviderId: selectedIconProviderId,
} = useSelectedModelInfo()

const hasOpened = shallowRef<boolean>(false)
const isOpen = shallowRef<boolean>(false)
const root = useTemplateRef<HTMLDivElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const panel = useTemplateRef<PanelHandle>('panel')
const panelId = useId()
const openPopover = useState<'models' | 'tools' | null>(
  'chat-input:open-popover',
  () => null,
)

const selectedModelId = computed<string>(() => {
  return selection.value.modelId
})

const selectedGatewayId = computed<GatewayId | null>(() => {
  const current = selection.value

  return current.source === 'gateway' ? current.gatewayId : null
})

function resetTransientState() {
  panel.value?.resetTransientState()
}

function close() {
  isOpen.value = false

  if (openPopover.value === 'models') {
    openPopover.value = null
  }
}

function closeAndRestoreFocus() {
  close()
  trigger.value?.focus()
}

/**
 * A mounted panel is prepared in the same tick `isOpen` flips, so no frame
 * renders stale search or filter state. On the first open there is no panel
 * yet; it mounts already open and prepares itself from setup.
 */
function toggle() {
  if (isOpen.value) {
    close()

    return
  }

  const mountedPanel = panel.value

  hasOpened.value = true
  isOpen.value = true
  openPopover.value = 'models'
  mountedPanel?.prepareOpen()
}

watch(openPopover, (current) => {
  if (current !== 'models' && isOpen.value) {
    close()
  }
})

function onSelect({ modelId, gatewayId }: {
  modelId: string
  gatewayId: GatewayId | null
}) {
  selection.value = gatewayId
    ? { source: 'gateway', gatewayId, modelId }
    : { source: 'provider', modelId }
  requestPersistence()
  closeAndRestoreFocus()
}

function onClose({ restoreFocus }: { restoreFocus: boolean }) {
  if (restoreFocus) {
    closeAndRestoreFocus()

    return
  }

  close()
}

onClickOutside(root, () => {
  if (!isOpen.value) {
    return
  }

  close()
})
</script>
