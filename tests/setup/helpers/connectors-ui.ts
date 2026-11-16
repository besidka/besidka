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
    toolMode: 'auto',
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
  const base = {
    name: 'search_issues',
    title: null,
    description: 'Search issues in the workspace.',
    readOnly: true,
    destructive: false,
    openWorld: null,
    alwaysAsk: false,
    change: 'none' as const,
    enabled: true,
    alwaysAllowed: false,
    ...overrides,
  }
  const derivedMode = base.alwaysAllowed ? 'allow' : 'ask'

  return {
    ...base,
    mode: overrides.mode ?? (base.enabled ? derivedMode : 'blocked'),
    canAlwaysAllow: overrides.canAlwaysAllow
      ?? (!base.alwaysAsk && base.change === 'none'),
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
