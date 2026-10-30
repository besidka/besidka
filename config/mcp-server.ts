export const MCP_SERVER_NAME = 'com.besidka/mcp'

export const MCP_SERVER_TITLE = 'Besidka'

export const MCP_SERVER_VERSION = '1.1.0'

export const MCP_SERVER_ROUTE = '/mcp'

export const MCP_MAX_REQUEST_BODY_BYTES = 32 * 1024

export const MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES = 512 * 1024

export const MCP_PROTECTED_RESOURCE_METADATA_PATH
  = `/.well-known/oauth-protected-resource${MCP_SERVER_ROUTE}`

export const MCP_PRIVATE_TOOL_RATE_LIMIT = { window: 60, max: 120 } as const

export const MCP_PRIVATE_WRITE_RATE_LIMIT = { window: 60, max: 30 } as const

export const MCP_PRIVATE_DELETE_RATE_LIMIT = {
  window: 3600,
  max: 20,
} as const

export const MCP_DISABLED_TOOLKIT_ROUTES = [
  `${MCP_SERVER_ROUTE}/deeplink`,
  `${MCP_SERVER_ROUTE}/badge.svg`,
] as const

export const MCP_SERVER_CARD_PATH = '/.well-known/mcp/server-card.json'

export const MCP_SERVER_DESCRIPTION
  = 'Besidka models, providers and key guides, plus your chats, projects, files, memory and settings.'

export const MCP_SERVER_REPOSITORY = {
  url: 'https://github.com/besidka/besidka',
  source: 'github',
} as const
