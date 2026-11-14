import type { ConnectorAuthType } from '#shared/utils/connectors-policy'

export interface ConnectorPreset {
  id: string
  title: string
  url: string
  auth: readonly Exclude<ConnectorAuthType, 'none'>[]
  headerName: string | null
  notice: string | null
}

export const CONNECTOR_CATALOG_FOOTER
  = 'Names belong to their owners. Besidka is not affiliated with them.'

export const CONNECTOR_PRESETS = [
  {
    id: 'github',
    title: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: ['header'],
    headerName: 'Authorization',
    notice: 'Use a fine-grained personal access token with the fewest '
      + 'permissions you need.',
  },
  {
    id: 'notion',
    title: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: 'If your workspace limits MCP clients, ask the admin to approve '
      + 'Besidka.',
  },
  {
    id: 'linear',
    title: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    auth: ['oauth', 'header'],
    headerName: 'Authorization',
    notice: null,
  },
  {
    id: 'atlassian',
    title: 'Atlassian',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: ['oauth', 'header'],
    headerName: 'Authorization',
    notice: 'Your Atlassian admin must allow besidka.com (or enable API '
      + 'tokens). Some tools use Rovo credits from your organization.',
  },
] as const satisfies readonly ConnectorPreset[]

export type ConnectorPresetId = typeof CONNECTOR_PRESETS[number]['id']

export function findConnectorPreset(
  presetId: string,
): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((preset) => {
    return preset.id === presetId
  })
}

export function findConnectorPresetByUrl(
  url: string,
): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((preset) => {
    return preset.url === url
  })
}
