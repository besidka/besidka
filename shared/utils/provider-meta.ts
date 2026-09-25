import type { GatewayId } from '#shared/types/gateways.d'

export interface ProviderMetaKeyField {
  name: 'apiKey' | 'accountId' | 'gatewayId'
  label: string
  secret: boolean
  required: boolean
}

export interface ProviderMeta {
  id: string
  kind: 'provider' | 'search' | 'gateway'
  label: string
  // A shorter form of `label` for inline use next to a noun it's already
  // qualifying, e.g. "Web search (Brave)" rather than "Web search (Brave
  // Search)". Only set where it differs from `label` — falls back to
  // `label` otherwise.
  shortLabel?: string
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
    shortLabel: 'Google',
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
  brave: {
    id: 'brave',
    kind: 'search',
    label: 'Brave Search',
    shortLabel: 'Brave',
    keyProviderId: 'brave',
    dashboardUrl: 'https://api-dashboard.search.brave.com/app/keys',
    dashboardLabel: 'Brave Search API → Subscriptions (the Search plan; '
      + 'a card is required even for the free monthly credit)',
    keyFields: [apiKeyField],
  },
  exa: {
    id: 'exa',
    kind: 'search',
    label: 'Exa',
    keyProviderId: 'exa',
    dashboardUrl: 'https://dashboard.exa.ai/api-keys',
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

export const enabledSearchProviders: string[] = ['brave', 'exa']

/**
 * Resolves a persisted `MessageUsage.provider` value back to its
 * `providerMeta` entry, matching against `keyProviderId` rather than the
 * object key directly. This indirection exists only because a persisted
 * `keys.provider` value does not always equal its `providerMeta` object key
 * — for example `vercel-gateway` is stored with the suffix, but its
 * `providerMeta` entry's `keyProviderId` may differ from the object key it
 * lives under. Callers treat an `undefined` result as "no provider row to
 * render."
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
