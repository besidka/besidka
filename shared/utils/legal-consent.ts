export const LEGAL_CONSENT_ERROR_CODE = 'LEGAL_CONSENT_REQUIRED'

export const TRANSFER_CONSENT_ERROR_CODE = 'TRANSFER_CONSENT_REQUIRED'

export const transferConsentProviderIds = [
  'deepseek',
  'moonshotai',
  'qwen',
] as const

export type TransferConsentProviderKey
  = typeof transferConsentProviderIds[number]

export interface TransferConsentProvider {
  id: TransferConsentProviderKey
  label: string
  country: string
}

export const transferConsentProviders: Record<
  TransferConsentProviderKey,
  TransferConsentProvider
> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    country: 'China',
  },
  moonshotai: {
    id: 'moonshotai',
    label: 'Moonshot AI',
    country: 'Singapore',
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    country: 'Singapore',
  },
}

export function isTransferConsentProviderId(
  providerId: string | null | undefined,
): providerId is TransferConsentProviderKey {
  return (transferConsentProviderIds as readonly string[])
    .includes(providerId ?? '')
}

const gatewayVendorTransferProviders: Record<
  string,
  TransferConsentProviderKey
> = {
  deepseek: 'deepseek',
  moonshotai: 'moonshotai',
  alibaba: 'qwen',
  qwen: 'qwen',
}

export interface TransferConsentRoute {
  providerId?: string | null
  gatewayId?: string | null
  modelId?: string | null
}

/**
 * The provider whose transfer consent a send needs: the direct provider, or
 * for a gateway the vendor named by the model id prefix (`deepseek/`,
 * `moonshotai/`, `alibaba/`, `qwen/`). Models a gateway hosts itself, such
 * as Cloudflare's `@cf/` ids, need none.
 */
export function resolveTransferConsentProviderId(
  route: TransferConsentRoute,
): TransferConsentProviderKey | null {
  if (route.gatewayId) {
    const vendor = route.modelId?.toLowerCase().split('/')[0] ?? ''

    return gatewayVendorTransferProviders[vendor] ?? null
  }

  return isTransferConsentProviderId(route.providerId)
    ? route.providerId
    : null
}
