import { parseError } from 'evlog'

export const ARTIFACT_DELETE_CONSEQUENCES
  = 'All versions are deleted, active share links stop working and viewers\' '
    + 'saved progress is removed. The chat message keeps a "deleted artifact" '
    + 'placeholder. This cannot be undone.'

const DELETE_ACTION = 'Delete'
const ALREADY_DELETED_STATUS = 404

export function reportArtifactDeleteResult(
  deletedCount: number,
  heldCount: number,
) {
  if (deletedCount) {
    useSuccessMessage(
      deletedCount === 1
        ? 'Artifact deleted'
        : `${deletedCount} artifacts deleted`,
    )
  }

  if (heldCount) {
    useWarningMessage(
      heldCount === 1
        ? 'One artifact could not be deleted'
        : `${heldCount} artifacts could not be deleted`,
      'They are on hold after a report and stay until the hold ends.',
    )
  }
}

/**
 * Deletes the artifact open in the side panel through the same bulk route as
 * History → Artifacts and MCP `delete_artifacts`, then closes the panel when
 * it still shows that artifact, marks every card of it as deleted and tells
 * the chat context and the library list to drop it. An artifact that is gone
 * already (404) counts as deleted.
 */
export function useArtifactDelete() {
  const nuxtApp = useNuxtApp()
  const panel = useArtifactPanel()

  const isDeleting = shallowRef<boolean>(false)

  async function requestDelete(artifactId: string): Promise<boolean> {
    try {
      const response = await $fetch('/api/v1/artifacts/delete/bulk', {
        method: 'POST',
        body: { ids: [artifactId] },
      })

      reportArtifactDeleteResult(
        response.deletedIds.length,
        response.heldIds.length,
      )

      return response.deletedIds.includes(artifactId)
    } catch (exception) {
      const parsedException = parseError(exception)

      if (parsedException.status === ALREADY_DELETED_STATUS) {
        return true
      }

      useErrorMessage(
        parsedException.message || 'Failed to delete the artifact',
        parsedException.why,
      )

      return false
    }
  }

  async function deleteArtifact(input: {
    artifactId: string
    title: string
  }): Promise<boolean> {
    if (isDeleting.value) {
      return false
    }

    isDeleting.value = true

    try {
      const confirmation = await useConfirm({
        text: `Delete "${input.title}"?`,
        subtitle: ARTIFACT_DELETE_CONSEQUENCES,
        alert: true,
        actions: [DELETE_ACTION],
      })

      if (!confirmation || !await requestDelete(input.artifactId)) {
        return false
      }
    } finally {
      isDeleting.value = false
    }

    if (panel.state.value?.artifactId === input.artifactId) {
      panel.close()
    }

    panel.markDeleted([input.artifactId])

    await nuxtApp.callHook('chat:context-changed')
    await nuxtApp.callHook('artifacts:deleted', [input.artifactId])

    return true
  }

  return { isDeleting, deleteArtifact }
}
