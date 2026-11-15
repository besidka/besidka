import type {
  ConnectorPageItem,
  ConnectorReviewTool,
  ConnectorToolsReview,
} from '#shared/types/connectors.d'

export function createConnectorItem(
  overrides: Partial<ConnectorPageItem> = {},
): ConnectorPageItem {
  return {
    id: 'conn1',
    slug: 'linear',
    title: 'Linear',
    host: 'mcp.linear.app',
    status: 'ready',
    enabled: false,
    authType: 'oauth',
    createdVia: 'preset',
    presetId: 'linear',
    addedByApp: null,
    consent: {
      state: 'current',
      issuerHost: 'mcp.linear.app',
      givenAt: '2026-11-15T10:00:00.000Z',
    },
    note: null,
    tools: { isBaselined: true, total: 3, enabled: 2, alwaysAllowed: 0 },
    createdAt: '2026-11-15T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    lastConnectedAt: '2026-11-15T10:00:00.000Z',
    ...overrides,
  }
}

export function createReviewTool(
  overrides: Partial<ConnectorReviewTool> = {},
): ConnectorReviewTool {
  return {
    name: 'search_issues',
    title: null,
    description: 'Search issues in the workspace.',
    readOnly: true,
    destructive: false,
    openWorld: null,
    alwaysAsk: false,
    change: 'none',
    enabled: true,
    alwaysAllowed: false,
    ...overrides,
  }
}

export function createToolsReview(
  overrides: Partial<ConnectorToolsReview> = {},
): ConnectorToolsReview {
  const tools = overrides.tools ?? [createReviewTool()]

  return {
    state: 'ok',
    isBaselined: true,
    reviewToken: 'a'.repeat(64),
    tools,
    removed: [],
    counts: {
      total: tools.length,
      enabled: tools.filter(tool => tool.enabled).length,
      pending: tools.filter(tool => tool.change !== 'none').length,
      perMessageLimit: 40,
    },
    ...overrides,
  }
}
