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
}

/**
 * Decides how a signed-in viewer may reach an artifact's viewer features
 * (saved progress, model calls). Only the owner is resolved here: share
 * links (`shareToken`, sent by the client in the `x-besidka-artifact-share`
 * header) are added with artifact shares (A-7), so until then any other
 * viewer gets the same 404 as an unknown or forged id. A taken-down artifact
 * answers 451, like every other owner route.
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

  if (!artifact) {
    throw createArtifactNotFoundError()
  }

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
