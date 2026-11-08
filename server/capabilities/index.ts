import type { ToolSet } from 'ai'
import type {
  CapabilityDefinition,
  CapabilityToolContext,
} from '~~/server/capabilities/types'
import { getRegisteredCapabilities } from '~~/server/capabilities/types'

export function listCapabilities(): readonly Readonly<CapabilityDefinition>[] {
  return getRegisteredCapabilities()
}

/**
 * Merges the chat tools of every capability whose flag is active for the
 * caller. Factories run one after another so none of them fans out
 * connections in parallel; a later tool with the same name wins.
 */
export async function getCapabilityTools(
  context: CapabilityToolContext,
  capabilities: readonly Readonly<CapabilityDefinition>[] = listCapabilities(),
): Promise<ToolSet> {
  const tools: ToolSet = {}

  for (const capability of capabilities) {
    if (!capability.aiTools || !context.isFeatureActive(capability.feature)) {
      continue
    }

    Object.assign(tools, await capability.aiTools(context))
  }

  return tools
}
