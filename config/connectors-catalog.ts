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
  {
    id: 'stripe',
    title: 'Stripe',
    url: 'https://mcp.stripe.com/',
    auth: ['oauth', 'header'],
    headerName: 'Authorization',
    notice: 'For a key, use an agent API key: Stripe stops accepting other '
      + 'secret keys on its MCP server from November 30, 2026.',
  },
  {
    id: 'vercel',
    title: 'Vercel',
    url: 'https://mcp.vercel.com/',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'supabase',
    title: 'Supabase',
    url: 'https://mcp.supabase.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'sentry',
    title: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'square',
    title: 'Square',
    url: 'https://mcp.squareup.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'intercom',
    title: 'Intercom',
    url: 'https://mcp.intercom.com/mcp',
    auth: ['oauth', 'header'],
    headerName: 'Authorization',
    notice: 'For US workspaces. An EU workspace uses '
      + 'https://mcp.eu.intercom.com/mcp: add it by URL.',
  },
  {
    id: 'clickup',
    title: 'ClickUp',
    url: 'https://mcp.clickup.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'miro',
    title: 'Miro',
    url: 'https://mcp.miro.com/',
    auth: ['oauth'],
    headerName: null,
    notice: 'On an Enterprise plan an admin must turn on MCP first.',
  },
  {
    id: 'todoist',
    title: 'Todoist',
    url: 'https://ai.todoist.net/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'webflow',
    title: 'Webflow',
    url: 'https://mcp.webflow.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
  },
  {
    id: 'wix',
    title: 'Wix',
    url: 'https://mcp.wix.com/mcp',
    auth: ['oauth'],
    headerName: null,
    notice: null,
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

function presetUrlKey(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')

    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`
      + parsed.search
  } catch {
    return url
  }
}

/**
 * The preset whose address is `url`, compared the way the directory compares
 * addresses: host case and a trailing slash do not matter, so
 * `https://mcp.stripe.com` and `https://MCP.stripe.com/` both find Stripe.
 */
export function findConnectorPresetByUrl(
  url: string,
): ConnectorPreset | undefined {
  const key = presetUrlKey(url)

  return CONNECTOR_PRESETS.find((preset) => {
    return presetUrlKey(preset.url) === key
  })
}
