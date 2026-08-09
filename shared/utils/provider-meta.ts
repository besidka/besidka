import type { GatewayId } from '#shared/types/gateways.d'

/**
 * The `accountId`/`gatewayId` field names below are forward scaffolding for
 * Cloudflare AI Gateway support landing in a later PR of this stack —
 * intentionally unwired here, not dead code.
 */
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
  keyFields: ProviderMetaKeyField[]
}

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
}

/**
 * Cloudflare AI Gateway is reserved in the `keys.provider` enum and in
 * `GatewayId`, but is intentionally NOT listed here yet — its `providerMeta`
 * entry (a 3-field `accountId`/`gatewayId`/`apiKey` form, decided but not
 * built until a later PR) would be the wrong shape to ship as a usable
 * single-`apiKey` gateway card today. This array, not a `providerMeta`
 * placeholder, is what marks it "not enabled yet": every gateway-rail/keys
 * UI should iterate `enabledGateways` (mapped through `providerMeta`)
 * rather than assuming all `GatewayId` values are ready.
 */
export const enabledGateways: GatewayId[] = ['vercel', 'openrouter']
