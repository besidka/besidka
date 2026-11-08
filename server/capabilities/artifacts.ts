import type { ArtifactKind } from '#shared/utils/artifacts'
import type { CapabilityToolContext } from '~~/server/capabilities/types'
import { ARTIFACT_KINDS } from '#shared/utils/artifacts'
import { defineCapability } from '~~/server/capabilities/types'
import { createArtifactTools } from '~~/server/utils/ai/artifact-tools'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { collectReferencedArtifactIds } from '~~/server/utils/artifacts/message-parts'

export function getAllowedArtifactKinds(
  isFeatureActive: CapabilityToolContext['isFeatureActive'],
): ArtifactKind[] {
  return ARTIFACT_KINDS.filter((kind) => {
    return kind !== 'react' || isFeatureActive('artifacts.react')
  })
}

export const artifactsCapability = defineCapability({
  feature: 'artifacts',
  routesPrefix: ['artifacts'],
  aiTools(context) {
    if (!context.assistantMessageId) {
      return {}
    }

    return createArtifactTools({
      db: context.db,
      storage: useArtifactBlobStore(),
      userId: context.userId,
      chatId: context.chatId,
      messageId: context.assistantMessageId,
      allowedKinds: getAllowedArtifactKinds(context.isFeatureActive),
      referencedArtifactIds: collectReferencedArtifactIds(
        context.messages ?? [],
      ),
      modelId: context.modelId ?? context.model?.id ?? null,
      logger: context.logger,
    })
  },
})
