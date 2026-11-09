import { resolveActiveArtifactShare } from '~~/server/utils/artifacts/shares'
import {
  assertNotTakenDown,
  createArtifactNotFoundError,
  decodeArtifactId,
  findOwnedArtifact,
} from '~~/server/utils/artifacts/store'

type DbClient = ReturnType<typeof useDb>

export type ArtifactViewerMode = 'owner' | 'share'

export interface ArtifactViewerAccess {
  mode: ArtifactViewerMode
  artifactId: string
  artifactInternalId: number
  ownerUserId: number
  viewerUserId: number
  storageAllowed: boolean
  bridgeAllowed: boolean
  shareId?: number
}

export interface ResolveArtifactViewerAccessInput {
  db: DbClient
  viewerUserId: number
  artifactId: string
  shareToken?: string | null
  now?: Date
}

/**
 * Decides how a signed-in viewer may reach an artifact's viewer features
 * (saved progress, model calls). The owner resolves first and keeps full
 * access; a taken-down artifact answers 451 to the owner, like every other
 * owner route. Anyone else needs the token of an active share link to
 * exactly this artifact (sent by the client in the
 * `x-besidka-artifact-share` header); `storageAllowed` and `bridgeAllowed`
 * then come from that link. Every other case (no token, an unknown, revoked,
 * expired or taken-down link, a link to another artifact) is the same 404
 * as an unknown id.
 */
export async function resolveArtifactViewerAccess(
  input: ResolveArtifactViewerAccessInput,
): Promise<ArtifactViewerAccess> {
  const internalId = decodeArtifactId(input.artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const artifact = await findOwnedArtifact(
    input.db,
    input.viewerUserId,
    internalId,
  )

  if (artifact) {
    assertNotTakenDown(artifact)

    return {
      mode: 'owner',
      artifactId: input.artifactId,
      artifactInternalId: artifact.id,
      ownerUserId: artifact.userId,
      viewerUserId: input.viewerUserId,
      storageAllowed: true,
      bridgeAllowed: true,
    }
  }

  const resolved = await resolveActiveArtifactShare({
    db: input.db,
    token: input.shareToken,
    now: input.now,
  })

  if (resolved?.status !== 'active' || resolved.artifact.id !== internalId) {
    throw createArtifactNotFoundError()
  }

  return {
    mode: 'share',
    artifactId: input.artifactId,
    artifactInternalId: resolved.artifact.id,
    ownerUserId: resolved.artifact.userId,
    viewerUserId: input.viewerUserId,
    storageAllowed: resolved.share.storageAllowed,
    bridgeAllowed: resolved.share.bridgeAllowed,
    shareId: resolved.share.id,
  }
}
