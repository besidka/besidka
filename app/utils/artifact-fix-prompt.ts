import { buildDiagramLimitFixPrompt } from '@besidka/artifacts-protocol'
import type { ArtifactRuntimeMessage } from '~/composables/artifacts'

/**
 * A diagram that hit a render limit cannot be fixed by the model changing
 * configuration, so the prompt asks for a smaller diagram instead of
 * repeating the runtime message.
 */
export function buildArtifactFixPrompt(
  title: string,
  error: ArtifactRuntimeMessage,
): string {
  if (error.code && error.limit) {
    return buildDiagramLimitFixPrompt(title, {
      code: error.code,
      limit: error.limit,
      found: error.found,
    })
  }

  return `Fix the error in "${title}": ${error.message}`
}
