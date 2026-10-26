<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="legal-consent-title"
    aria-describedby="legal-consent-description"
    data-testid="legal-consent-modal"
    @cancel.prevent="decline"
  >
    <form
      class="modal-box grid max-h-[90svh] gap-4 overflow-y-auto"
      @submit.prevent="accept"
    >
      <h2
        id="legal-consent-title"
        class="text-lg font-bold"
      >
        {{ title }}
      </h2>
      <div
        id="legal-consent-description"
        class="grid gap-3 text-sm"
      >
        <p>
          Besidka stores your chats and sends each message to the AI
          provider, AI gateway or search provider you choose. Anything you
          type or upload can contain sensitive information, such as details
          of your health, religion or beliefs, political opinions, sex life
          or sexual orientation, ethnic origin, trade union membership, or
          genetic or biometric data. I can't separate that from the rest of a
          chat without reading it, and I don't read your chats.
        </p>
        <p>
          <NuxtLink
            to="/privacy-policy#sensitive-information-in-your-chats"
            target="_blank"
            class="link"
          >
            What changed in the Privacy Policy
          </NuxtLink>
        </p>
      </div>
      <fieldset class="grid gap-3">
        <legend class="sr-only">
          Your consent
        </legend>
        <label class="flex cursor-pointer items-start gap-3 text-sm">
          <input
            v-model="isTermsAccepted"
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
            data-testid="legal-consent-terms"
          >
          <span>
            I am 18 or over and I accept the
            <NuxtLink
              to="/terms-of-use"
              target="_blank"
              class="link"
            >
              Terms of Use</NuxtLink>.
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 text-sm">
          <input
            v-model="isSensitiveConsentGiven"
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
            data-testid="legal-consent-sensitive"
          >
          <span>
            <strong>I explicitly consent</strong> to Besidka storing any
            sensitive information I choose to include in my chats, projects
            and files, sending it to the AI providers, AI gateways and search
            providers whose keys I add (for my chats, project memory and
            memory), and automatically checking text before it is saved to
            memory so that sensitive topics are kept out, as described in the
            <NuxtLink
              to="/privacy-policy#sensitive-information-in-your-chats"
              target="_blank"
              class="link"
            >
              Privacy Policy</NuxtLink>.
          </span>
        </label>
      </fieldset>
      <p class="text-sm text-base-content/70">
        This consent is separate from the Terms of Use. You can withdraw it at
        any time in Profile → Security → Privacy &amp; consent. Besidka then
        stops sending new messages until you consent again; your existing
        chats stay until you delete them.
      </p>
      <div class="modal-action mt-0 flex-wrap">
        <button
          type="button"
          class="btn btn-ghost btn-sm min-w-28"
          :disabled="isSaving"
          data-testid="legal-consent-decline"
          @click="decline"
        >
          Not now
        </button>
        <button
          type="submit"
          class="btn btn-primary btn-sm min-w-28"
          :disabled="!canContinue"
          data-testid="legal-consent-continue"
        >
          Continue
        </button>
      </div>
      <div
        class="grid gap-3 rounded-box border border-base-content/10 p-4 text-sm"
        data-testid="legal-consent-refusal"
      >
        <p>
          If you choose "Not now", you can still read, export and delete your
          data, but you can't send messages.
        </p>
        <div class="flex flex-wrap gap-2">
          <a
            href="/api/v1/memory/export"
            download
            class="btn btn-ghost btn-ghost-legacy btn-sm min-w-40"
            data-testid="legal-consent-export"
          >
            <Icon
              name="lucide:download"
              size="16"
            />
            Export my memory
          </a>
          <button
            type="button"
            class="btn btn-ghost btn-sm min-w-40 text-error"
            data-testid="legal-consent-delete-account"
            @click="deleteAccount"
          >
            <Icon
              name="lucide:trash-2"
              size="16"
            />
            Delete account
          </button>
        </div>
        <p class="text-base-content/70">
          The memory export holds your memory entries and settings. For a
          copy of your chats and everything else, see
          <NuxtLink
            to="/privacy-policy#getting-a-copy-of-your-data"
            target="_blank"
            class="link"
          >
            Getting a copy of your data</NuxtLink>.
        </p>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
const {
  state,
  isSaving,
  giveConsent,
  resolveConsentModal,
} = useLegalConsent()
const { requestAccountDeletion } = useAccountDeletion()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const isTermsAccepted = shallowRef<boolean>(false)
const isSensitiveConsentGiven = shallowRef<boolean>(false)

const title = computed<string>(() => {
  if (state.value?.status === 'outdated') {
    return 'The consent text has changed'
  }

  return 'Before you send a message'
})

const canContinue = computed<boolean>(() => {
  return isTermsAccepted.value
    && isSensitiveConsentGiven.value
    && !isSaving.value
})

onMounted(() => {
  dialog.value?.showModal()
})

function close(isGranted: boolean) {
  dialog.value?.close()
  resolveConsentModal(isGranted)
}

async function accept() {
  if (!canContinue.value) {
    return
  }

  if (!await giveConsent()) {
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

async function deleteAccount() {
  close(false)
  await requestAccountDeletion()
}
</script>
