export const LEGAL_CONSENT_ERROR_CODE = 'LEGAL_CONSENT_REQUIRED'

export const TRANSFER_CONSENT_ERROR_CODE = 'TRANSFER_CONSENT_REQUIRED'

export const transferConsentProviderIds = [
  'deepseek',
  'moonshotai',
  'qwen',
  'zai',
  'minimax',
  'tencent',
  'bytedance',
  'router',
] as const

export type TransferConsentProviderKey
  = typeof transferConsentProviderIds[number]

export type TransferConsentRouteKind = 'direct' | 'gateway' | 'router'

export interface TransferConsentProvider {
  id: TransferConsentProviderKey
  label: string
  country: string
  route: TransferConsentRouteKind
}

export const transferConsentProviders: Record<
  TransferConsentProviderKey,
  TransferConsentProvider
> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    country: 'China',
    route: 'direct',
  },
  moonshotai: {
    id: 'moonshotai',
    label: 'Moonshot AI',
    country: 'Singapore',
    route: 'direct',
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    country: 'Singapore',
    route: 'direct',
  },
  zai: {
    id: 'zai',
    label: 'Z.ai (Zhipu AI)',
    country: 'Singapore',
    route: 'gateway',
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    country: 'Singapore',
    route: 'gateway',
  },
  tencent: {
    id: 'tencent',
    label: 'Tencent',
    country: 'China',
    route: 'gateway',
  },
  bytedance: {
    id: 'bytedance',
    label: 'ByteDance',
    country: 'Malaysia or Indonesia',
    route: 'gateway',
  },
  router: {
    id: 'router',
    label: 'Router and preset models',
    country: 'any country, including China and Singapore',
    route: 'router',
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
  'deepseek': 'deepseek',
  'moonshotai': 'moonshotai',
  'alibaba': 'qwen',
  'qwen': 'qwen',
  'z-ai': 'zai',
  'zai': 'zai',
  'minimax': 'minimax',
  'tencent': 'tencent',
  'bytedance': 'bytedance',
  'bytedance-seed': 'bytedance',
  'openrouter': 'router',
}

const GATEWAY_ALIAS_VENDOR_PREFIX = '~'
const GATEWAY_PRESET_MARKER = '@preset/'

export interface TransferConsentRoute {
  providerId?: string | null
  gatewayId?: string | null
  modelId?: string | null
}

function readGatewayVendor(modelId: string): string {
  const vendor = modelId.split('/')[0] ?? ''

  return vendor.startsWith(GATEWAY_ALIAS_VENDOR_PREFIX)
    ? vendor.slice(GATEWAY_ALIAS_VENDOR_PREFIX.length)
    : vendor
}

/**
 * The provider whose transfer consent a send needs: the direct provider, or
 * for a gateway the vendor named by the model id prefix (`deepseek/`,
 * `moonshotai/`, `alibaba/`, `qwen/`, `z-ai/`, `zai/`, `minimax/`,
 * `tencent/`, `bytedance/`, `bytedance-seed/`), also behind OpenRouter's
 * `~vendor/...-latest` aliases. A router id that can send the request to
 * any vendor (OpenRouter's `openrouter/` meta-routers and any
 * `@preset/` reference) needs the generic `router` consent. Models a
 * gateway hosts itself, such as Cloudflare's `@cf/` ids, need none.
 */
export function resolveTransferConsentProviderId(
  route: TransferConsentRoute,
): TransferConsentProviderKey | null {
  if (route.gatewayId) {
    const modelId = route.modelId?.toLowerCase() ?? ''

    if (modelId.includes(GATEWAY_PRESET_MARKER)) {
      return 'router'
    }

    return gatewayVendorTransferProviders[readGatewayVendor(modelId)] ?? null
  }

  return isTransferConsentProviderId(route.providerId)
    ? route.providerId
    : null
}
