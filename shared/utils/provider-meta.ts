export interface ProviderMetaKeyField {
  name: 'apiKey' | 'accountId'
  label: string
  secret: boolean
  required: boolean
}

export interface ProviderMeta {
  id: string
  kind: 'provider'
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
}

/**
 * Resolves a persisted `MessageUsage.provider` value back to its
 * `providerMeta` entry, matching against `keyProviderId` rather than the
 * object key directly. Messages sent through a now-removed integration
 * persisted a value that never matched a `providerMeta` key — those simply
 * resolve to `undefined` here, which callers already treat as "no provider
 * row to render."
 */
export function resolveProviderMetaByKeyProviderId(
  keyProviderId: string,
): ProviderMeta | undefined {
  return Object.values(providerMeta).find((meta) => {
    return meta.keyProviderId === keyProviderId
  })
}
