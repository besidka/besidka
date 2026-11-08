import type { KVNamespace } from '@cloudflare/workers-types'
import type { ToolSet } from 'ai'
import type { Model } from '#shared/types/providers.d'
import type { FeatureKey } from '#shared/utils/features/registry'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'

/**
 * Everything a capability's chat tools may use, captured by the caller
 * before any parallel work starts. Tool factories never read the request
 * event. `model` is undefined for a gateway send (no curated model), so
 * `modelId` is the reliable id. `assistantMessageId` is the public id the
 * reply will be persisted under, and `messages` the chat history loaded
 * from D1 before this send.
 */
export interface CapabilityToolContext {
  userId: number
  chatId: string
  db: ReturnType<typeof useDb>
  kv: KVNamespace
  model: Model | undefined
  modelId?: string
  assistantMessageId?: string
  messages?: ReadonlyArray<{ role: string, parts: unknown }>
  logger: LoggerLike
  isFeatureActive: (flag: FeatureKey) => boolean
}

/**
 * A background job of a capability. `feature` is checked with
 * `evaluateFeature` before the job runs, because jobs have no request
 * context for `requireFeature`.
 */
export interface CapabilityJob {
  kind: string
  feature: FeatureKey
}

export interface CapabilityDefinition {
  feature: FeatureKey
  aiTools?: (context: CapabilityToolContext) => Promise<ToolSet> | ToolSet
  routesPrefix?: readonly string[]
  mcpTools?: readonly McpPrivateToolName[]
  jobs?: readonly Readonly<CapabilityJob>[]
  clientChunk?: string
}

const registeredCapabilities: Readonly<CapabilityDefinition>[] = []

/**
 * Declares a capability module: its feature flag and every surface it adds.
 * The definition is frozen and registered for `listCapabilities()`, which the
 * conformance spec walks to prove each surface is gated. A second definition
 * for the same feature replaces the first, so a module evaluated twice (hot
 * reload) never registers twice.
 */
export function defineCapability(
  definition: CapabilityDefinition,
): Readonly<CapabilityDefinition> {
  const frozen = Object.freeze({
    ...definition,
    routesPrefix: definition.routesPrefix
      ? Object.freeze([...definition.routesPrefix])
      : undefined,
    mcpTools: definition.mcpTools
      ? Object.freeze([...definition.mcpTools])
      : undefined,
    jobs: definition.jobs
      ? Object.freeze(definition.jobs.map((job) => {
        return Object.freeze({ ...job })
      }))
      : undefined,
  }) as Readonly<CapabilityDefinition>

  const existingIndex = registeredCapabilities.findIndex((capability) => {
    return capability.feature === frozen.feature
  })

  if (existingIndex === -1) {
    registeredCapabilities.push(frozen)
  } else {
    registeredCapabilities[existingIndex] = frozen
  }

  return frozen
}

export function getRegisteredCapabilities(): readonly Readonly<
  CapabilityDefinition
>[] {
  return [...registeredCapabilities]
}
