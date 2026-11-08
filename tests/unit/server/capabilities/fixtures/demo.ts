import type { FeatureKey } from '#shared/utils/features/registry'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'
import { defineCapability } from '~~/server/capabilities/types'

export const demoCompliantCapability = defineCapability({
  feature: 'artifacts',
  routesPrefix: ['demo-artifacts'],
  mcpTools: ['list_memory'],
  jobs: [{ kind: 'demo-artifacts-render', feature: 'artifacts.react' }],
  aiTools: () => {
    return { demo_tool: {} as never }
  },
})

export const demoUnknownFeatureCapability = defineCapability({
  feature: 'demo.unknown' as FeatureKey,
})

export const demoUnguardedRouteCapability = defineCapability({
  feature: 'documents',
  routesPrefix: ['demo-documents'],
})

export const demoUnscopedMcpCapability = defineCapability({
  feature: 'skills',
  mcpTools: ['demo_unscoped_tool' as McpPrivateToolName],
})

export const demoUnflaggedJobCapability = defineCapability({
  feature: 'connectors',
  jobs: [
    { kind: 'demo-no-flag', feature: '' as FeatureKey },
    { kind: 'demo-foreign-flag', feature: 'documents' },
  ],
})
