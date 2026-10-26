<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="legal-transfer-consent-title"
    aria-describedby="legal-transfer-consent-description"
    data-testid="legal-transfer-consent-modal"
    @cancel.prevent="decline"
  >
    <form
      v-if="provider"
      class="modal-box grid gap-4"
      @submit.prevent="accept"
    >
      <h2
        id="legal-transfer-consent-title"
        class="text-lg font-bold"
      >
        Your messages will leave the EU
      </h2>
      <div
        id="legal-transfer-consent-description"
        class="grid gap-3 text-sm"
      >
        <p
          v-if="isRouter"
          data-testid="legal-transfer-consent-router-text"
        >
          A router or preset model picks the model that answers each message,
          and it may send your request to providers in countries the European
          Commission has not found to protect personal data to EU standards,
          such as China or Singapore. Besidka cannot know in advance which
          provider will receive it and has no contract with them that adds
          safeguards. Your messages, files, excerpts of your earlier chats and
          your memory may be accessed by authorities there under local law,
          and you may not be able to enforce your EU data-protection rights
          against those providers.
        </p>
        <p v-else>
          {{ provider.label }} processes data in {{ provider.country }}. The
          European Commission has not found that {{ provider.country }}
          protects personal data to EU standards, and Besidka has no contract
          with {{ provider.label }} that adds safeguards. Your messages,
          files, excerpts of your earlier chats and your memory sent to
          {{ provider.label }} may be accessed by authorities there under
          local law, and you may not be able to enforce your EU
          data-protection rights against {{ provider.label }}.
        </p>
        <p>
          <NuxtLink
            to="/privacy-policy#transfers-outside-the-eu"
            target="_blank"
            class="link"
          >
            Transfers outside the EU in the Privacy Policy
          </NuxtLink>
        </p>
      </div>
      <label class="flex cursor-pointer items-start gap-3 text-sm">
        <input
          v-model="isTransferConsentGiven"
          type="checkbox"
          class="checkbox checkbox-sm mt-0.5"
          data-testid="legal-transfer-consent-checkbox"
        >
        <span v-if="isRouter">
          <strong>I explicitly consent</strong> to Besidka sending my
          messages, files, chat excerpts and memory through router and preset
          models to providers in any country, including China and Singapore,
          knowing these risks.
        </span>
        <span v-else>
          <strong>I explicitly consent</strong> to Besidka sending my
          messages, files, chat excerpts and memory to {{ provider.label }}
          in {{ provider.country }}, knowing these risks.
        </span>
      </label>
      <p class="text-sm text-base-content/70">
        {{ refusalText }}
      </p>
      <div class="modal-action mt-0">
        <button
          type="button"
          class="btn btn-ghost btn-sm min-w-28"
          :disabled="isSaving"
          data-testid="legal-transfer-consent-cancel"
          @click="decline"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary btn-sm min-w-28"
          :disabled="!canContinue"
          data-testid="legal-transfer-consent-continue"
        >
          {{ continueLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import type { TransferConsentProvider } from '#shared/utils/legal-consent'
import { transferConsentProviders } from '#shared/utils/legal-consent'

const {
  transferRequest,
  isSaving,
  giveTransferConsent,
  resolveTransferModal,
} = useLegalConsent()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const isTransferConsentGiven = shallowRef<boolean>(false)

const provider = computed<TransferConsentProvider | null>(() => {
  const providerId = transferRequest.value?.providerId

  return providerId ? transferConsentProviders[providerId] : null
})

const isRouter = computed<boolean>(() => {
  return provider.value?.route === 'router'
})

const continueLabel = computed<string>(() => {
  return transferRequest.value?.context === 'key' ? 'Add key' : 'Continue'
})

const refusalText = computed<string>(() => {
  const label = provider.value?.label ?? ''

  if (isRouter.value) {
    return 'If you cancel, router and preset models can\'t be used to send '
      + 'messages. You can pick a specific model instead.'
  }

  if (transferRequest.value?.context === 'key') {
    return `If you cancel, the key is not saved and ${label} can't be used `
      + 'to send messages.'
  }

  return `If you cancel, ${label} can't be used to send messages. Your key `
    + 'stays saved, and you can pick a model from another provider.'
})

const canContinue = computed<boolean>(() => {
  return isTransferConsentGiven.value && !isSaving.value
})

onMounted(() => {
  dialog.value?.showModal()
})

function close(isGranted: boolean) {
  dialog.value?.close()
  resolveTransferModal(isGranted)
}

async function accept() {
  const providerId = transferRequest.value?.providerId

  if (!canContinue.value || !providerId) {
    return
  }

  if (!await giveTransferConsent(providerId)) {
    return
  }

  close(true)
}

function decline() {
  if (isSaving.value) {
    return
  }

  close(false)
}
</script>
