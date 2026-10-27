<template>
  <div
    class="grid gap-4"
    data-testid="privacy-consent"
  >
    <div
      v-if="!state"
      class="skeleton skeleton--default h-16 w-full"
    />
    <template v-else>
      <div class="grid gap-3">
        <p
          v-if="state.status === 'current'"
          class="text-sm"
          data-testid="privacy-consent-status"
        >
          You consented on
          <UiLocalDate :value="state.sensitiveContentConsentAt!" />
          to version {{ state.sensitiveContentConsentVersion }} of the
          consent text, and accepted the Terms of Use and confirmed you are
          18 or over.
        </p>
        <p
          v-else-if="state.status === 'withdrawn'"
          class="text-sm"
          data-testid="privacy-consent-status"
        >
          You withdrew your consent on
          <UiLocalDate :value="state.sensitiveContentConsentWithdrawnAt!" />.
          Besidka does not send new messages or store new content until you
          consent again. You can still read, export and delete your data.
        </p>
        <p
          v-else-if="state.status === 'outdated'"
          class="text-sm"
          data-testid="privacy-consent-status"
        >
          The consent text changed since you agreed to version
          {{ state.sensitiveContentConsentVersion }}. Review it to keep
          sending messages.
        </p>
        <p
          v-else
          class="text-sm"
          data-testid="privacy-consent-status"
        >
          You have not given your consent yet. You need it to send messages
          and add new content.
        </p>
        <p class="text-sm text-base-content/70">
          Read what it covers in the
          <NuxtLink
            to="/privacy-policy#sensitive-information-in-your-chats"
            class="link"
            target="_blank"
          >
            Privacy Policy</NuxtLink>.
        </p>
        <div class="flex flex-wrap gap-2">
          <UiButton
            v-if="state.status === 'current'"
            mode="error"
            size="sm"
            outline
            normal-case
            class="min-w-40"
            icon-name="lucide:circle-x"
            text="Withdraw consent"
            :disabled="isSaving"
            data-testid="privacy-consent-withdraw"
            @click="withdraw"
          />
          <UiButton
            v-else
            size="sm"
            normal-case
            class="min-w-40"
            icon-name="lucide:circle-check"
            text="Review and consent"
            :disabled="isSaving"
            data-testid="privacy-consent-give"
            @click="openConsentModal"
          />
          <UiButton
            v-if="state.status === 'withdrawn'"
            mode="error"
            size="sm"
            ghost
            normal-case
            class="min-w-40"
            icon-name="lucide:trash-2"
            text="Delete account"
            :disabled="isDeleting"
            data-testid="privacy-consent-delete-account"
            @click="requestAccountDeletion"
          />
        </div>
      </div>
      <div class="grid gap-2">
        <p class="text-sm font-bold">
          Transfers outside the EU
        </p>
        <ul
          class="grid gap-2"
          data-testid="privacy-consent-transfers"
        >
          <li
            v-for="transfer in state.transfers"
            :key="transfer.providerId"
            class="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-content/10 px-4 py-3"
            :data-testid="`privacy-consent-transfer-${transfer.providerId}`"
          >
            <div class="text-sm">
              <p class="font-medium">
                {{ transfer.label }} in {{ transfer.country }}
              </p>
              <p class="text-base-content/70">
                <template v-if="transfer.isGranted && transfer.consentedAt">
                  You consented on
                  <UiLocalDate :value="transfer.consentedAt" />.
                </template>
                <template v-else-if="transfer.withdrawnAt">
                  Withdrawn on <UiLocalDate :value="transfer.withdrawnAt" />.
                  Asked again before your next message to
                  {{ transfer.label }}.
                </template>
                <template v-else-if="transfer.route === 'direct'">
                  Not given. Asked when you add a {{ transfer.label }} key.
                </template>
                <template v-else-if="transfer.route === 'router'">
                  Not given. Asked before your first message to a router or
                  preset model through a gateway.
                </template>
                <template v-else>
                  Not given. Asked before your first message to
                  {{ transfer.label }} models through a gateway.
                </template>
              </p>
            </div>
            <UiButton
              v-if="transfer.isGranted"
              mode="error"
              size="xs"
              ghost
              normal-case
              class="min-w-24"
              text="Withdraw"
              :disabled="isSaving"
              :data-testid="withdrawTestId(transfer.providerId)"
              @click="withdrawTransfer(transfer.providerId, transfer.label)"
            />
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TransferConsentProviderId } from '#shared/types/legal-consent.d'

const {
  state,
  isSaving,
  load,
  openConsentModal,
  withdrawConsent,
  withdrawTransferConsent,
} = useLegalConsent()
const {
  isDeleting,
  requestAccountDeletion,
} = useAccountDeletion()

onMounted(async () => {
  await load({ force: true })
})

function withdrawTestId(providerId: TransferConsentProviderId): string {
  return `privacy-consent-transfer-withdraw-${providerId}`
}

async function withdraw() {
  const result = await useConfirm({
    text: 'Withdraw your consent?',
    subtitle: 'Besidka will stop sending new messages and storing new '
      + 'content until you consent again. Your chats stay until you delete them. To remove sensitive '
      + 'information you already stored, delete the chats, projects or files '
      + 'that contain it, or email the address in the Privacy Policy.',
    alert: true,
    actions: ['Withdraw'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  if (!await withdrawConsent()) {
    return
  }

  useInfoMessage(
    'Consent withdrawn',
    'Besidka will not send new messages or store new content until you '
    + 'consent again. You can still delete your account below.',
  )
}

async function withdrawTransfer(
  providerId: TransferConsentProviderId,
  label: string,
) {
  const result = await useConfirm({
    text: `Withdraw your consent to transfers to ${label}?`,
    subtitle: `${label} can no longer be used to send messages until you `
      + 'consent again. Your key stays saved.',
    actions: ['Withdraw'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  if (await withdrawTransferConsent(providerId)) {
    useInfoMessage(`Transfers to ${label} stopped`)
  }
}
</script>
