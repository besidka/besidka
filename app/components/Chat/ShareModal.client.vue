<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="chat-share-modal"
      class="js-chat-share-modal modal modal-bottom sm:modal-middle"
      @close="onModalClosed"
    >
      <div class="modal-box max-w-lg max-h-[80vh] flex flex-col">
        <h3 class="shrink-0 text-lg font-bold">
          Share chat
        </h3>

        <div class="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4">
          <div>
            <label class="label" for="chat-share-duration">
              <span class="label-text">Link expires</span>
            </label>
            <select
              id="chat-share-duration"
              v-model="duration"
              data-testid="share-duration-select"
              class="select select-bordered w-full"
            >
              <option value="week">1 week</option>
              <option value="month">1 month</option>
              <option value="year">1 year</option>
              <option value="forever">Forever</option>
            </select>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                v-model="indexable"
                type="checkbox"
                data-testid="share-toggle-indexable"
                class="toggle toggle-sm"
              >
              <span class="label-text">
                Allow search engines to index this page
              </span>
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                v-model="showFiles"
                type="checkbox"
                data-testid="share-toggle-files"
                class="toggle toggle-sm"
              >
              <span class="label-text">
                Show images & file names
              </span>
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                v-model="showMetadata"
                type="checkbox"
                data-testid="share-toggle-metadata"
                class="toggle toggle-sm"
              >
              <span class="label-text">
                Show message details (date, cost, tokens)
              </span>
            </label>
          </div>

          <div
            v-if="targetHasFiles && showFiles"
            data-testid="share-files-warning"
            role="alert"
            class="alert alert-warning alert-soft text-sm"
          >
            <Icon name="lucide:triangle-alert" size="16" />
            <span>
              Images and file names in this chat will be visible to
              anyone with the link.
            </span>
          </div>

          <div
            v-if="share"
            class="pt-2 space-y-2"
          >
            <label class="label" for="chat-share-link">
              <span class="label-text">Share link</span>
            </label>
            <div class="join w-full">
              <input
                id="chat-share-link"
                data-testid="share-link-input"
                type="text"
                readonly
                class="input input-bordered join-item flex-1"
                :value="share.url ?? ''"
              >
              <button
                type="button"
                class="btn join-item"
                @click="onCopyLink"
              >
                Copy
              </button>
            </div>
            <a
              v-if="share.url"
              :href="share.url"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary text-sm"
            >
              Open shared page
            </a>
          </div>
        </div>

        <div class="shrink-0 modal-action">
          <button
            v-if="share"
            type="button"
            data-testid="share-revoke-button"
            class="btn btn-error btn-soft btn-sm"
            :disabled="isSaving"
            @click="onRevoke"
          >
            Stop sharing
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="close"
          >
            Close
          </button>
          <button
            type="button"
            data-testid="share-generate-button"
            class="btn btn-primary btn-sm"
            :disabled="isSaving"
            @click="onGenerate"
          >
            {{ share ? 'Update' : 'Generate link' }}
          </button>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { ChatShareDuration } from '~/types/chat-share.d'

const {
  isModalOpen,
  targetChatSlug,
  targetHasFiles,
  share,
  isSaving,
  closeShareModal,
  createOrUpdateShare,
  revokeShare,
} = useChatShare()

const modal = useTemplateRef<HTMLDialogElement>('modal')

const duration = shallowRef<ChatShareDuration>('forever')
const indexable = shallowRef<boolean>(true)
const showFiles = shallowRef<boolean>(true)
const showMetadata = shallowRef<boolean>(true)

function inferDurationFromExpiresAt(
  expiresAt: string | null,
): ChatShareDuration {
  if (!expiresAt) {
    return 'forever'
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const daysRemaining = Math.round(
    (new Date(expiresAt).getTime() - Date.now()) / millisecondsPerDay,
  )

  if (daysRemaining <= 10) {
    return 'week'
  }

  if (daysRemaining <= 60) {
    return 'month'
  }

  return 'year'
}

watch(share, (nextShare) => {
  if (!nextShare) {
    duration.value = 'forever'
    indexable.value = true
    showFiles.value = true
    showMetadata.value = true

    return
  }

  duration.value = inferDurationFromExpiresAt(nextShare.expiresAt)
  indexable.value = nextShare.indexable
  showFiles.value = nextShare.showFiles
  showMetadata.value = nextShare.showMetadata
}, { immediate: true })

watch(isModalOpen, (open) => {
  if (!modal.value) {
    return
  }

  if (open) {
    modal.value.showModal()

    return
  }

  modal.value.close()
}, { flush: 'post' })

function close() {
  modal.value?.close()
}

function onModalClosed() {
  closeShareModal()
}

async function onCopyLink() {
  if (!share.value?.url) {
    return
  }

  try {
    await navigator.clipboard.writeText(share.value.url)
    useSuccessMessage('Link copied to clipboard')
  } catch {
    useErrorMessage('Failed to copy link')
  }
}

async function onGenerate() {
  if (!targetChatSlug.value) {
    return
  }

  await createOrUpdateShare(targetChatSlug.value, {
    duration: duration.value,
    indexable: indexable.value,
    showFiles: showFiles.value,
    showMetadata: showMetadata.value,
  })
}

async function onRevoke() {
  if (!targetChatSlug.value) {
    return
  }

  await revokeShare(targetChatSlug.value)
}
</script>
