import type { GatewayId } from '#shared/types/gateways.d'

export interface ProviderMetaKeyField {
  name: 'apiKey' | 'accountId' | 'gatewayId'
  label: string
  secret: boolean
  required: boolean
}

export interface ProviderMeta {
  id: string
  kind: 'provider' | 'gateway'
  label: string
  keyProviderId: string
  dashboardUrl: string
  dashboardLabel?: string
  keyPlaceholder?: string
  keyFields: ProviderMetaKeyField[]
}

export const defaultKeyPlaceholder = 'xxxx...'

const apiKeyField: ProviderMetaKeyField = {
  name: 'apiKey',
  label: 'API Key',
  secret: true,
  required: true,
}

export const providerMeta: Record<string, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    kind: 'provider',
    label: 'Anthropic',
    keyProviderId: 'anthropic',
    dashboardUrl: 'https://platform.claude.com/settings/workspaces/default/keys',
    keyPlaceholder: 'sk-ant-api03-xxxx...-xxxx...',
    keyFields: [apiKeyField],
  },
  google: {
    id: 'google',
    kind: 'provider',
    label: 'Google AI Studio',
    keyProviderId: 'google',
    dashboardUrl: 'https://aistudio.google.com/app/apikey',
    keyFields: [apiKeyField],
  },
  openai: {
    id: 'openai',
    kind: 'provider',
    label: 'OpenAI',
    keyProviderId: 'openai',
    dashboardUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-proj-x-xxxx...-xxxx...',
    keyFields: [apiKeyField],
  },
  xai: {
    id: 'xai',
    kind: 'provider',
    label: 'xAI',
    keyProviderId: 'xai',
    dashboardUrl: 'https://console.x.ai/team/default/api-keys',
    keyFields: [apiKeyField],
  },
  deepseek: {
    id: 'deepseek',
    kind: 'provider',
    label: 'DeepSeek',
    keyProviderId: 'deepseek',
    dashboardUrl: 'https://platform.deepseek.com/api_keys',
    keyFields: [apiKeyField],
  },
  moonshotai: {
    id: 'moonshotai',
    kind: 'provider',
    label: 'Moonshot AI',
    keyProviderId: 'moonshotai',
    dashboardUrl: 'https://platform.kimi.ai/console/api-keys',
    keyFields: [apiKeyField],
  },
  qwen: {
    id: 'qwen',
    kind: 'provider',
    label: 'Qwen',
    keyProviderId: 'qwen',
    dashboardUrl: 'https://bailian.console.alibabacloud.com/cn-beijing?tab=model#/api-key',
    dashboardLabel: 'Alibaba Cloud Model Studio → API-KEY (this app uses the international endpoint — switch to a non-China region in the console before creating your key, or it will fail)',
    keyFields: [apiKeyField],
  },
  vercel: {
    id: 'vercel',
    kind: 'gateway',
    label: 'Vercel AI Gateway',
    keyProviderId: 'vercel-gateway',
    dashboardUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys',
    dashboardLabel: 'Vercel dashboard → AI Gateway → API Keys',
    keyFields: [apiKeyField],
  },
  openrouter: {
    id: 'openrouter',
    kind: 'gateway',
    label: 'OpenRouter',
    keyProviderId: 'openrouter',
    dashboardUrl: 'https://openrouter.ai/settings/keys',
    keyFields: [apiKeyField],
  },
  cloudflare: {
    id: 'cloudflare',
    kind: 'gateway',
    label: 'Cloudflare AI Gateway',
    keyProviderId: 'cloudflare-gateway',
    dashboardUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
    dashboardLabel: 'Cloudflare dashboard → Workers AI (API token + Account ID)',
    keyFields: [
      {
        name: 'accountId',
        label: 'Account ID',
        secret: false,
        required: true,
      },
      {
        name: 'gatewayId',
        label: 'Gateway ID (optional, defaults to "default")',
        secret: false,
        required: false,
      },
      apiKeyField,
    ],
  },
}

/**
 * Resolves a persisted `MessageUsage.provider` value back to its
 * `providerMeta` entry. That value is NOT always a `providerMeta` key: gateway
 * sends persist `keyProviderIdForGateway(gatewayId)` instead (e.g.
 * `'cloudflare-gateway'`, `'vercel-gateway'`), which only equals the key for
 * OpenRouter. Direct-provider sends persist the `providerMeta` key itself, so
 * matching against every entry's `keyProviderId` resolves both cases
 * uniformly instead of assuming the persisted string IS the key.
 */
export function resolveProviderMetaByKeyProviderId(
  keyProviderId: string,
): ProviderMeta | undefined {
  return Object.values(providerMeta).find((meta) => {
    return meta.keyProviderId === keyProviderId
  })
}

/**
 * Every `GatewayId` this app can actually route a chat send through and
 * fetch a catalog for. Gateway-rail/keys UI iterates this array (mapped
 * through `providerMeta`) rather than assuming every `GatewayId` value is
 * ready — that's how a future gateway lands without a flag day: reserve the
 * `GatewayId`/`keys.provider` values first, wire the feature, then add the
 * id here last.
 *
 * The order (Cloudflare, OpenRouter, Vercel) is a deliberate product
 * decision, not an incidental default — every gateway-listing UI (keys
 * page, picker rail) must display in this exact order, so a future gateway's
 * id is placed deliberately, not just appended or alphabetized.
 */
export const enabledGateways: GatewayId[] = [
  'cloudflare',
  'openrouter',
  'vercel',
]
