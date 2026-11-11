<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="modal modal-bottom sm:modal-middle"
      data-testid="artifact-bridge-modal"
      aria-labelledby="artifact-bridge-title"
      @cancel.prevent="onCancel"
      @close="onDialogClosed"
    >
      <div class="modal-box flex max-h-[90dvh] max-w-lg flex-col gap-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div class="shrink-0">
          <h3
            id="artifact-bridge-title"
            class="text-lg font-bold"
          >
            Allow an AI request?
          </h3>
          <p
            class="text-sm break-words text-base-content/70"
            data-testid="artifact-bridge-artifact-title"
          >
            “<bdi>{{ titlePreview }}</bdi>” wants to ask an AI model using your
            API key.
          </p>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <p
            class="alert alert-warning alert-soft text-sm"
            data-testid="artifact-bridge-author-note"
          >
            The author of this artifact wrote these prompts, not you and not
            Besidka.
          </p>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">
              Prompt ({{ promptSize }})
            </legend>
            <pre
              class="max-h-48 overflow-y-auto rounded-box bg-base-200 p-3 font-mono text-xs break-words whitespace-pre-wrap"
              data-testid="artifact-bridge-prompt"
            >{{ promptPreview }}</pre>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">
              System text sent with it
            </legend>
            <pre
              class="max-h-40 overflow-y-auto rounded-box bg-base-200 p-3 font-mono text-xs break-words whitespace-pre-wrap"
              data-testid="artifact-bridge-system"
            >{{ systemPreview }}</pre>
          </fieldset>

          <div
            v-if="pending.isLoadingInfo"
            class="flex flex-col gap-2"
            aria-busy="true"
          >
            <span class="skeleton skeleton--default block h-9 w-full" />
            <span class="skeleton skeleton--default block h-4 w-2/3" />
          </div>
          <div
            v-else-if="pending.infoError"
            class="alert alert-error alert-soft text-sm"
            role="alert"
            data-testid="artifact-bridge-info-error"
          >
            {{ pending.infoError.message }}
          </div>
          <div
            v-else-if="!models.length"
            class="alert alert-soft text-sm"
            role="alert"
            data-testid="artifact-bridge-no-key"
          >
            <div>
              <p class="font-medium">
                This needs a direct provider key
              </p>
              <p>
                Artifacts use only your own provider keys, not gateways.
                <NuxtLink
                  to="/profile/keys"
                  class="link"
                >
                  Add a key in Profile → API keys
                </NuxtLink>
              </p>
            </div>
          </div>
          <template v-else>
            <fieldset class="fieldset">
              <label
                class="fieldset-legend"
                :for="modelSelectId"
              >
                Model
              </label>
              <select
                :id="modelSelectId"
                v-model="selectedModelId"
                class="select select-sm w-full"
                data-testid="artifact-bridge-model"
                :disabled="pending.isRunning"
              >
                <option
                  v-for="model in models"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.providerName }} · {{ model.name }}
                </option>
              </select>
            </fieldset>
            <ul
              class="space-y-1 text-sm text-base-content/80"
              data-testid="artifact-bridge-facts"
            >
              <li data-testid="artifact-bridge-tokens">
                At most {{ pending.maxOutputTokens.toLocaleString('en') }}
                output tokens
              </li>
              <li data-testid="artifact-bridge-cost">
                Maximum cost: {{ costText }}, billed by
                {{ selectedModel?.providerName ?? 'the provider' }} to your key
              </li>
              <li data-testid="artifact-bridge-remaining">
                {{ remainingText }}
              </li>
              <li>
                {{ selectedModel?.providerName ?? 'The provider' }}'s terms
                apply to this request, as in your chats.
              </li>
            </ul>
            <label
              v-if="pending.allowRemember"
              class="label cursor-pointer gap-2 text-sm whitespace-normal"
            >
              <input
                v-model="remember"
                type="checkbox"
                class="checkbox checkbox-sm"
                data-testid="artifact-bridge-remember"
                :disabled="pending.isRunning"
              >
              Don't ask again for this artifact until I close it. Later
              requests are sent without showing them, up to
              {{ pending.info?.remaining.hour ?? 0 }} more this hour.
            </label>
          </template>

          <div
            v-if="pending.error"
            class="alert alert-error alert-soft items-start text-sm"
            role="alert"
            data-testid="artifact-bridge-error"
          >
            <div class="min-w-0">
              <p class="font-medium">
                {{ pending.error.message }}
              </p>
              <p
                v-if="pending.error.why"
                class="break-words"
              >
                {{ pending.error.why }}
              </p>
              <NuxtLink
                v-if="pending.error.link"
                :to="pending.error.link"
                class="link"
              >
                Learn more
              </NuxtLink>
            </div>
          </div>
        </div>

        <div class="modal-action mt-0 shrink-0">
          <button
            ref="cancelButton"
            type="button"
            class="btn btn-ghost"
            data-testid="artifact-bridge-cancel"
            :disabled="pending.isRunning"
            @click="onCancel"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="artifact-bridge-allow"
            :disabled="!canAllow"
            @pointerdown="onAllowPointerDown"
            @click="onAllowClick"
          >
            <span
              v-if="pending.isRunning"
              class="loading loading-spinner loading-sm"
              aria-hidden="true"
            />
            {{ pending.error ? 'Try again' : 'Allow' }}
          </button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { buildArtifactBridgeSystem } from '#shared/utils/artifacts'
import type { PendingArtifactCompletion } from '~/composables/artifact-bridge'
import {
  countLines,
  estimateArtifactBridgeMaxCost,
  formatArtifactBridgeCost,
  formatArtifactBridgePreview,
  revealInvisibleCharacters,
} from '~/utils/artifact-bridge'

const props = defineProps<{
  pending: PendingArtifactCompletion
}>()

const emit = defineEmits<{
  allow: [modelId: string, remember: boolean]
  cancel: []
}>()

const ALLOW_ARMING_DELAY_MS = 700

const modal = useTemplateRef<HTMLDialogElement>('modal')
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton')
const modelSelectId = useId()
const selectedModelId = shallowRef<string>('')
const remember = shallowRef<boolean>(false)

let armedAt = 0
let pressedAllowSinceOpen = false
let isUnmounting = false

const models = computed(() => {
  return props.pending.info?.models ?? []
})

const selectedModel = computed(() => {
  return models.value.find((model) => {
    return model.id === selectedModelId.value
  }) ?? null
})

const systemText = computed<string>(() => {
  return buildArtifactBridgeSystem(props.pending.system)
})

const titlePreview = computed<string>(() => {
  return revealInvisibleCharacters(props.pending.title)
})

const promptPreview = computed<string>(() => {
  return formatArtifactBridgePreview(props.pending.prompt)
})

const systemPreview = computed<string>(() => {
  return formatArtifactBridgePreview(systemText.value)
})

const promptSize = computed<string>(() => {
  const characterCount = props.pending.prompt.length
  const lines = countLines(props.pending.prompt)
  const characters = characterCount === 1
    ? '1 character'
    : `${characterCount.toLocaleString('en')} characters`

  return `${characters}, ${lines} ${lines === 1 ? 'line' : 'lines'}`
})

const costText = computed<string>(() => {
  const model = selectedModel.value

  if (!model) {
    return formatArtifactBridgeCost(null)
  }

  return formatArtifactBridgeCost(estimateArtifactBridgeMaxCost(
    model,
    props.pending.prompt.length + systemText.value.length,
    props.pending.maxOutputTokens,
  ))
})

const remainingText = computed<string>(() => {
  const info = props.pending.info

  if (!info) {
    return ''
  }

  return `${info.remaining.hour} of ${info.limits.hour} requests left this `
    + `hour for this artifact, ${info.remaining.day} of ${info.limits.day} `
    + 'today'
})

const canAllow = computed<boolean>(() => {
  return !props.pending.isRunning
    && !props.pending.isLoadingInfo
    && !!selectedModel.value
    && (props.pending.info?.remaining.hour ?? 0) > 0
    && (props.pending.info?.remaining.day ?? 0) > 0
})

watch(canAllow, (allowed) => {
  armedAt = allowed ? Date.now() : 0
}, { immediate: true })

watch(() => props.pending.info, (info) => {
  if (!info || selectedModel.value) {
    return
  }

  selectedModelId.value = info.defaultModelId ?? info.models[0]?.id ?? ''
}, { immediate: true })

function onCancel() {
  if (props.pending.isRunning) {
    return
  }

  emit('cancel')
}

function onAllowPointerDown() {
  pressedAllowSinceOpen = true
}

function onDialogClosed() {
  if (isUnmounting) {
    return
  }

  if (props.pending.isRunning) {
    modal.value?.showModal()

    return
  }

  emit('cancel')
}

/**
 * Allow counts only after it has been enabled for a moment, and a pointer
 * click only when the press also started on Allow after the modal opened,
 * so a click or tap aimed at the artifact (which may open this modal at
 * any time) cannot land on Allow by accident.
 */
function onAllowClick(event: MouseEvent) {
  const isKeyboardClick = event.detail === 0

  if (!canAllow.value || !armedAt) {
    return
  }

  if (Date.now() - armedAt < ALLOW_ARMING_DELAY_MS) {
    return
  }

  if (!isKeyboardClick && !pressedAllowSinceOpen) {
    return
  }

  pressedAllowSinceOpen = false
  emit('allow', selectedModelId.value, remember.value)
}

onMounted(async () => {
  modal.value?.showModal()
  await nextTick()
  cancelButton.value?.focus()
})

onBeforeUnmount(() => {
  isUnmounting = true
  modal.value?.close()
})
</script>
