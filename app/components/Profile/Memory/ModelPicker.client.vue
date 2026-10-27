<template>
  <div class="contents">
    <fieldset class="grid gap-3">
      <legend class="mb-2 text-sm font-bold">{{ label }}</legend>
      <div class="rounded-box border border-base-content/15 divide-y divide-base-content/10">
        <label class="flex items-start gap-3 p-3 cursor-pointer">
          <input
            type="radio"
            class="radio radio-sm mt-1"
            :name="groupName"
            :checked="!hasSpecificModel"
            data-testid="memory-model-same-as-chat"
            @change="selectSameAsChat"
          >
          <span class="grid gap-1">
            <span class="font-bold">Same as chat</span>
            <span class="text-sm text-base-content/70">
              Uses whichever model you're chatting with.
            </span>
          </span>
        </label>
        <div class="flex flex-wrap items-center gap-3 p-3">
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              class="radio radio-sm"
              :name="groupName"
              :checked="hasSpecificModel"
              data-testid="memory-model-specific"
              @change="selectSpecificModel"
            >
            <span class="font-bold">A specific model</span>
          </label>
          <button
            v-if="modelValue"
            type="button"
            class="btn btn-ghost btn-sm gap-2"
            :aria-label="`${label}: ${triggerName}`"
            data-testid="memory-model-trigger"
            @click="openModal"
          >
            <ProviderIcon
              v-if="triggerIconProviderId"
              :provider-id="triggerIconProviderId"
              class="!size-4 shrink-0"
            />
            <span class="truncate max-w-48">{{ triggerName }}</span>
            <Icon
              name="lucide:chevron-down"
              size="16"
              class="shrink-0"
            />
          </button>
        </div>
      </div>
    </fieldset>
    <Teleport to="body">
      <dialog
        ref="modal"
        data-testid="memory-model-modal"
        class="js-memory-model-modal modal modal-bottom sm:modal-middle"
        :aria-labelledby="headingId"
        @cancel.prevent
        @close="onModalClosed"
      >
        <div class="modal-box max-w-2xl max-h-[80vh] flex flex-col">
          <div class="mb-4 flex shrink-0 items-center justify-between gap-2">
            <h3
              :id="headingId"
              class="text-xl font-bold"
            >
              {{ label }}
            </h3>
            <form method="dialog">
              <button
                class="btn btn-sm btn-circle btn-ghost"
                aria-label="Close"
                data-testid="memory-model-modal-close"
              >
                <Icon name="lucide:x" size="16" />
              </button>
            </form>
          </div>
          <div class="relative flex-1 min-h-0 overflow-hidden">
            <ChatInputModelsTriggerPanel
              v-if="hasBeenOpened"
              ref="panel"
              :is-open="isModalOpen"
              :selected-model-id="modelValue?.model ?? null"
              :selected-gateway-id="modelValue?.gateway ?? null"
              :filter-model="isMemoryModelSelectable"
              :filter-gateway-model="isMemoryGatewayModelSelectable"
              :recommended-model-ids="recommendedModelIds"
              recommended-filter
              class="!shadow-none"
              @select="onModelSelected"
              @close="closeModal"
            />
          </div>
        </div>
        <form
          method="dialog"
          class="modal-backdrop"
        >
          <button>Close</button>
        </form>
      </dialog>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { GatewayId } from '#shared/types/gateways.d'

interface ModelChoice {
  model: string
  gateway: GatewayId | null
}

defineProps<{
  label: string
  recommendedModelIds: string[]
}>()

const modelValue = defineModel<ModelChoice | null>({ required: true })

const headingId = useId()
const groupName = `memory-model-${useId()}`
const modal = useTemplateRef<HTMLDialogElement>('modal')
const panel = useTemplateRef<{ prepareOpen: () => void | Promise<void> }>(
  'panel',
)
const gatewayCatalogCache = useGatewayCatalogCache()

const hasBeenOpened = shallowRef<boolean>(false)
const isModalOpen = shallowRef<boolean>(false)
const isChoosingModel = shallowRef<boolean>(false)

const hasSpecificModel = computed<boolean>(() => {
  return !!modelValue.value || isChoosingModel.value
})

const triggerName = computed<string>(() => {
  const choice = modelValue.value

  if (!choice) {
    return ''
  }

  if (!choice.gateway) {
    return getModelName(choice.model)
  }

  const gatewayModels = gatewayCatalogCache.value[choice.gateway] ?? []
  const gatewayModel = gatewayModels.find((candidate) => {
    return candidate.id === choice.model
  })

  return gatewayModel?.name || choice.model
})

const triggerIconProviderId = computed<string | null>(() => {
  const choice = modelValue.value

  if (!choice) {
    return null
  }

  if (choice.gateway) {
    return choice.gateway
  }

  return getModel(choice.model).provider?.id ?? null
})

async function openModal() {
  if (!modal.value || modal.value.open) {
    return
  }

  hasBeenOpened.value = true
  isModalOpen.value = true

  await nextTick()

  modal.value.showModal()

  await nextTick()

  await panel.value?.prepareOpen()
}

function closeModal() {
  if (modal.value?.open) {
    modal.value.close()
  }
}

function onModalClosed() {
  if (modal.value?.open) {
    return
  }

  isModalOpen.value = false
  isChoosingModel.value = false
}

function selectSameAsChat() {
  isChoosingModel.value = false
  modelValue.value = null
}

async function selectSpecificModel() {
  if (modelValue.value) {
    return
  }

  isChoosingModel.value = true

  await openModal()
}

function onModelSelected(selection: {
  modelId: string
  gatewayId: GatewayId | null
}) {
  modelValue.value = {
    model: selection.modelId,
    gateway: selection.gatewayId,
  }

  closeModal()
}
</script>
