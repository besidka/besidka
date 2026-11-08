import type { CapabilityDefinition } from '~~/server/capabilities/types'
import { getFeatureDefinition, isFeatureKey } from '#shared/utils/features/registry'

export type CapabilityViolationRule
  = | 'unknown_feature'
    | 'route_without_feature_guard'
    | 'route_prefix_without_routes'
    | 'mcp_tool_without_scope'
    | 'mcp_tool_without_private_wrapper'
    | 'job_without_feature'

export interface CapabilityViolation {
  feature: string
  rule: CapabilityViolationRule
  detail: string
}

export interface CapabilitySourceFile {
  path: string
  source: string
}

export interface CapabilityConformanceReaders {
  readRouteFiles: (prefix: string) => CapabilitySourceFile[]
  readMcpToolSource: (toolName: string) => string | null
  mcpToolScopes: Readonly<Record<string, string>>
}

const FEATURE_GUARD_CALL = 'requireFeature('
const MCP_PRIVATE_WRAPPER_CALL = 'withMcpPrivateTool('

function isSameOrDescendantFeature(flag: string, ancestor: string): boolean {
  let current = getFeatureDefinition(flag)

  while (current) {
    if (current.key === ancestor) {
      return true
    }

    current = current.parent ? getFeatureDefinition(current.parent) : undefined
  }

  return false
}

function checkRoutes(
  capability: Readonly<CapabilityDefinition>,
  readers: CapabilityConformanceReaders,
): CapabilityViolation[] {
  const violations: CapabilityViolation[] = []

  for (const prefix of capability.routesPrefix ?? []) {
    const files = readers.readRouteFiles(prefix)

    if (!files.length) {
      violations.push({
        feature: capability.feature,
        rule: 'route_prefix_without_routes',
        detail: prefix,
      })
    }

    for (const file of files) {
      if (!file.source.includes(FEATURE_GUARD_CALL)) {
        violations.push({
          feature: capability.feature,
          rule: 'route_without_feature_guard',
          detail: file.path,
        })
      }
    }
  }

  return violations
}

function checkMcpTools(
  capability: Readonly<CapabilityDefinition>,
  readers: CapabilityConformanceReaders,
): CapabilityViolation[] {
  const violations: CapabilityViolation[] = []

  for (const toolName of capability.mcpTools ?? []) {
    if (!Object.hasOwn(readers.mcpToolScopes, toolName)) {
      violations.push({
        feature: capability.feature,
        rule: 'mcp_tool_without_scope',
        detail: toolName,
      })
    }

    const source = readers.readMcpToolSource(toolName)

    if (!source?.includes(MCP_PRIVATE_WRAPPER_CALL)) {
      violations.push({
        feature: capability.feature,
        rule: 'mcp_tool_without_private_wrapper',
        detail: toolName,
      })
    }
  }

  return violations
}

function checkJobs(
  capability: Readonly<CapabilityDefinition>,
): CapabilityViolation[] {
  return (capability.jobs ?? [])
    .filter((job) => {
      return !job.feature
        || !isFeatureKey(job.feature)
        || !isSameOrDescendantFeature(job.feature, capability.feature)
    })
    .map((job) => {
      return {
        feature: capability.feature,
        rule: 'job_without_feature' as const,
        detail: job.kind,
      }
    })
}

/**
 * Checks one capability against the contract: its flag is in the registry,
 * every route file under its prefixes calls `requireFeature`, every MCP tool
 * has a scope and goes through `withMcpPrivateTool`, and every job names the
 * capability's flag or a child of it. The source checks are a heuristic;
 * the readers are injected so the spec can run them over fixtures.
 */
export function checkCapabilityConformance(
  capability: Readonly<CapabilityDefinition>,
  readers: CapabilityConformanceReaders,
): CapabilityViolation[] {
  if (!isFeatureKey(capability.feature)) {
    return [{
      feature: String(capability.feature),
      rule: 'unknown_feature',
      detail: String(capability.feature),
    }]
  }

  return [
    ...checkRoutes(capability, readers),
    ...checkMcpTools(capability, readers),
    ...checkJobs(capability),
  ]
}
