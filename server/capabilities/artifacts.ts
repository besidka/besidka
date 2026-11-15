import type { ArtifactKind } from '#shared/utils/artifacts'
import type { CapabilityToolContext } from '~~/server/capabilities/types'
import { ARTIFACT_KINDS } from '#shared/utils/artifacts'
import { defineCapability } from '~~/server/capabilities/types'
import { createArtifactTools } from '~~/server/utils/ai/artifact-tools'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { listChatArtifactIds } from '~~/server/utils/artifacts/chat-artifacts'

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
  async aiTools(context) {
    if (!context.assistantMessageId) {
      return {}
    }

    const chatArtifactIds = await listChatArtifactIds({
      db: context.db,
      userId: context.userId,
      chatId: context.chatId,
      attachedArtifactIds: context.attachedArtifactIds,
    })

    return createArtifactTools({
      db: context.db,
      storage: useArtifactBlobStore(),
      userId: context.userId,
      chatId: context.chatId,
      messageId: context.assistantMessageId,
      allowedKinds: getAllowedArtifactKinds(context.isFeatureActive),
      chatArtifactIds,
      modelId: context.modelId ?? context.model?.id ?? null,
      logger: context.logger,
    })
  },
})
