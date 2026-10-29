export const MCP_SERVER_NAME = 'com.besidka/mcp'

export const MCP_SERVER_TITLE = 'Besidka'

export const MCP_SERVER_VERSION = '1.0.0'

export const MCP_SERVER_ROUTE = '/mcp'

export const MCP_MAX_REQUEST_BODY_BYTES = 32 * 1024

export const MCP_DISABLED_TOOLKIT_ROUTES = [
  `${MCP_SERVER_ROUTE}/deeplink`,
  `${MCP_SERVER_ROUTE}/badge.svg`,
] as const

export const MCP_SERVER_CARD_PATH = '/.well-known/mcp/server-card.json'

export const MCP_SERVER_DESCRIPTION
  = 'Read-only facts about Besidka: the model catalog with prices and capabilities, supported providers and gateways, and step-by-step API key guides.'

export const MCP_SERVER_REPOSITORY = {
  url: 'https://github.com/besidka/besidka',
  source: 'github',
} as const
