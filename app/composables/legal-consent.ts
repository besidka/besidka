import type {
  LegalConsentState,
  ProviderTransferConsentState,
  TransferConsentProviderId,
} from '#shared/types/legal-consent.d'
import { isTransferConsentProviderId } from '#shared/utils/legal-consent'
import { parseError } from 'evlog'

export type TransferConsentContext = 'key' | 'send'

export interface TransferConsentRequest {
  providerId: TransferConsentProviderId
  context: TransferConsentContext
}

const LEGAL_CONSENT_STALE_AFTER_MS = 60_000

let consentResolver: ((isGranted: boolean) => void) | null = null
let transferResolver: ((isGranted: boolean) => void) | null = null
let loadedAt = 0

export function useLegalConsent() {
  const state = useState<LegalConsentState | null>(
    'legal-consent:state',
    () => null,
  )
  const isConsentModalOpen = useState<boolean>(
    'legal-consent:modal-open',
    () => false,
  )
  const transferRequest = useState<TransferConsentRequest | null>(
    'legal-consent:transfer-request',
    () => null,
  )
  const isSaving = useState<boolean>(
    'legal-consent:is-saving',
    () => false,
  )
  const boundUserId = useState<string | null>(
    'legal-consent:bound-user-id',
    () => null,
  )
  const stateUserId = useState<string | null>(
    'legal-consent:state-user-id',
    () => null,
  )

  const isCurrent = computed<boolean>(() => {
    return state.value?.status === 'current'
  })

  function applyState(nextState: LegalConsentState) {
    state.value = nextState
    stateUserId.value = boundUserId.value
    loadedAt = Date.now()
  }

  /**
   * Drops the cached consent state and settles any open dialog as refused,
   * so nothing one user saw or answered is reused for the next one.
   */
  function reset() {
    consentResolver?.(false)
    consentResolver = null
    transferResolver?.(false)
    transferResolver = null
    state.value = null
    stateUserId.value = null
    isConsentModalOpen.value = false
    transferRequest.value = null
    loadedAt = 0
  }

  function bindUser(userId: string | null) {
    if (boundUserId.value === userId) {
      return
    }

    boundUserId.value = userId
    reset()
  }

  async function load(options: { force?: boolean } = {}) {
    if (state.value && stateUserId.value !== boundUserId.value) {
      reset()
    }

    const isFresh = state.value
      && Date.now() - loadedAt < LEGAL_CONSENT_STALE_AFTER_MS

    if (isFresh && !options.force) {
      return state.value
    }

    const requestedForUserId = boundUserId.value

    try {
      const response = await $fetch('/api/v1/profiles/consent')

      if (requestedForUserId !== boundUserId.value) {
        return null
      }

      if (response?.status) {
        applyState(response)
      }
    } catch {
      return state.value
    }

    return state.value
  }

  function findTransfer(
    providerId: TransferConsentProviderId,
  ): ProviderTransferConsentState | undefined {
    return state.value?.transfers.find((transfer) => {
      return transfer.providerId === providerId
    })
  }

  function isTransferGranted(providerId: string | null | undefined): boolean {
    if (!isTransferConsentProviderId(providerId)) {
      return true
    }

    return findTransfer(providerId)?.isGranted === true
  }

  function openConsentModal(): Promise<boolean> {
    consentResolver?.(false)
    isConsentModalOpen.value = true

    return new Promise((resolve) => {
      consentResolver = resolve
    })
  }

  function resolveConsentModal(isGranted: boolean) {
    isConsentModalOpen.value = false

    const resolve = consentResolver

    consentResolver = null
    resolve?.(isGranted)
  }

  function openTransferModal(
    request: TransferConsentRequest,
  ): Promise<boolean> {
    transferResolver?.(false)
    transferRequest.value = request

    return new Promise((resolve) => {
      transferResolver = resolve
    })
  }

  function resolveTransferModal(isGranted: boolean) {
    transferRequest.value = null

    const resolve = transferResolver

    transferResolver = null
    resolve?.(isGranted)
  }

  async function ensureTransferConsent(
    providerId: string | null | undefined,
    context: TransferConsentContext,
  ): Promise<boolean> {
    if (!isTransferConsentProviderId(providerId)) {
      return true
    }

    const loadedState = await load()

    if (!loadedState || isTransferGranted(providerId)) {
      return true
    }

    return await openTransferModal({ providerId, context })
  }

  /**
   * Resolves `true` when a message may be sent with the key of
   * `keyOwnerId`: the Terms and sensitive-information consent are current,
   * and the provider's transfer consent exists when it needs one. Opens the
   * matching dialog otherwise. A failed status read lets the send through;
   * the server refuses it with a 403 if consent is really missing.
   */
  async function ensureSendConsent(
    keyOwnerId: string | null | undefined,
  ): Promise<boolean> {
    const loadedState = await load()

    if (!loadedState) {
      return true
    }

    if (!isCurrent.value && !await openConsentModal()) {
      return false
    }

    return await ensureTransferConsent(keyOwnerId, 'send')
  }

  async function runSave(request: () => Promise<LegalConsentState>) {
    isSaving.value = true

    try {
      applyState(await request())

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to save your choice',
        parsedException.why,
      )

      return false
    } finally {
      isSaving.value = false
    }
  }

  async function giveConsent(): Promise<boolean> {
    const version = state.value?.currentVersion
      ?? (await load({ force: true }))?.currentVersion

    if (!version) {
      useErrorMessage('Failed to load the consent text version')

      return false
    }

    return await runSave(() => {
      return $fetch('/api/v1/profiles/consent', {
        method: 'POST',
        body: {
          version,
          acceptTerms: true,
          confirmAge: true,
          sensitiveContentConsent: true,
        },
      })
    })
  }

  async function withdrawConsent(): Promise<boolean> {
    return await runSave(() => {
      return $fetch('/api/v1/profiles/consent/withdraw', {
        method: 'POST',
      })
    })
  }

  async function giveTransferConsent(
    providerId: TransferConsentProviderId,
  ): Promise<boolean> {
    return await runSave(() => {
      return $fetch('/api/v1/profiles/consent/transfers', {
        method: 'POST',
        body: {
          provider: providerId,
          transferConsent: true,
        },
      })
    })
  }

  async function withdrawTransferConsent(
    providerId: TransferConsentProviderId,
  ): Promise<boolean> {
    return await runSave(() => {
      return $fetch('/api/v1/profiles/consent/transfers/withdraw', {
        method: 'POST',
        body: {
          provider: providerId,
        },
      })
    })
  }

  return {
    state,
    isCurrent,
    isSaving,
    isConsentModalOpen,
    transferRequest,
    load,
    reset,
    bindUser,
    findTransfer,
    isTransferGranted,
    openConsentModal,
    resolveConsentModal,
    resolveTransferModal,
    ensureSendConsent,
    ensureTransferConsent,
    giveConsent,
    withdrawConsent,
    giveTransferConsent,
    withdrawTransferConsent,
  }
}
