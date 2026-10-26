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
