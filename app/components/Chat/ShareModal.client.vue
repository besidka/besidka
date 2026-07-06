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

        <div
          class="flex-1 min-h-0 overflow-y-auto mt-2.5 py-1.5 -mx-1.5 px-1.5 space-y-4"
        >
          <template v-if="isLoading">
            <div
              data-testid="share-form-skeleton"
              class="space-y-4"
            >
              <div class="skeleton skeleton--default h-9 w-full rounded-lg" />
              <div class="skeleton skeleton--default h-6 w-full rounded-lg" />
              <div class="skeleton skeleton--default h-6 w-full rounded-lg" />
              <div class="skeleton skeleton--default h-6 w-full rounded-lg" />
              <div class="skeleton skeleton--default h-6 w-full rounded-lg" />
              <div class="skeleton skeleton--default h-6 w-full rounded-lg" />
            </div>
          </template>
          <template v-else>
            <div>
              <label class="label mb-1.5" for="chat-share-duration">
                <span class="label-text">Link expires</span>
              </label>
              <select
                id="chat-share-duration"
                v-model="duration"
                data-testid="share-duration-select"
                class="select select-bordered select-sm w-full"
              >
                <option value="day">1 day</option>
                <option value="week">1 week</option>
                <option value="month">1 month</option>
                <option value="year">1 year</option>
                <option value="never">Never</option>
              </select>
            </div>

            <div class="form-control">
              <label
                class="label cursor-pointer w-full flex items-center
                  justify-between gap-3"
              >
                <span class="label-text flex-1 min-w-0 text-start">
                  Allow search engines to index this page
                </span>
                <input
                  v-model="indexable"
                  type="checkbox"
                  data-testid="share-toggle-indexable"
                  class="toggle toggle-sm shrink-0"
                >
              </label>
            </div>

            <div class="form-control">
              <label
                class="label cursor-pointer w-full flex items-center
                  justify-between gap-3"
              >
                <span class="label-text flex-1 min-w-0 text-start">
                  Show images & file names
                </span>
                <input
                  v-model="showFiles"
                  type="checkbox"
                  data-testid="share-toggle-files"
                  class="toggle toggle-sm shrink-0"
                >
              </label>
            </div>

            <div class="form-control">
              <label
                class="label cursor-pointer w-full flex items-center
                  justify-between gap-3"
              >
                <span class="label-text flex-1 min-w-0 text-start">
                  Show message details (date & time)
                </span>
                <input
                  v-model="showMetadata"
                  type="checkbox"
                  data-testid="share-toggle-metadata"
                  class="toggle toggle-sm shrink-0"
                >
              </label>
            </div>

            <div class="form-control">
              <label
                class="label cursor-pointer w-full flex items-center
                  justify-between gap-3"
              >
                <span class="label-text flex-1 min-w-0 text-start">
                  Show author's picture
                </span>
                <input
                  v-model="showAuthorAvatar"
                  type="checkbox"
                  data-testid="share-toggle-author"
                  class="toggle toggle-sm shrink-0"
                >
              </label>
            </div>

            <div class="form-control">
              <label
                class="label cursor-pointer w-full flex items-center
                  justify-between gap-3"
              >
                <span class="label-text flex-1 min-w-0 text-start">
                  Allow branching
                </span>
                <input
                  v-model="allowBranch"
                  type="checkbox"
                  data-testid="share-toggle-branch"
                  class="toggle toggle-sm shrink-0"
                >
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
                  data-testid="share-copy-button"
                  class="btn join-item gap-1.5"
                  @click="onCopyLink"
                >
                  <Icon
                    :name="justCopied ? 'lucide:check' : 'lucide:copy'"
                    size="14"
                    class="transition-transform duration-200"
                  />
                  <span class="transition-opacity duration-200">
                    {{ justCopied ? 'Copied!' : 'Copy' }}
                  </span>
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
          </template>
        </div>

        <div class="shrink-0 modal-action">
          <button
            v-if="share"
            type="button"
            data-testid="share-revoke-button"
            class="btn btn-error btn-soft btn-sm"
            :disabled="isSaving || isLoading"
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
            :disabled="isSaving || isLoading"
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
  isLoading,
  isSaving,
  closeShareModal,
  createOrUpdateShare,
  revokeShare,
} = useChatShare()

const modal = useTemplateRef<HTMLDialogElement>('modal')

const duration = shallowRef<ChatShareDuration>('never')
const indexable = shallowRef<boolean>(true)
const showFiles = shallowRef<boolean>(true)
const showMetadata = shallowRef<boolean>(true)
const showAuthorAvatar = shallowRef<boolean>(true)
const allowBranch = shallowRef<boolean>(true)
const justCopied = shallowRef<boolean>(false)

let copiedTimeoutId: ReturnType<typeof setTimeout> | null = null

function inferDurationFromExpiresAt(
  expiresAt: string | null,
): ChatShareDuration {
  if (!expiresAt) {
    return 'never'
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const daysRemaining = Math.round(
    (new Date(expiresAt).getTime() - Date.now()) / millisecondsPerDay,
  )

  if (daysRemaining <= 2) {
    return 'day'
  }

  if (daysRemaining <= 10) {
    return 'week'
  }

  if (daysRemaining <= 60) {
    return 'month'
  }

  return 'year'
}

function resetCopiedState() {
  justCopied.value = false

  if (copiedTimeoutId) {
    clearTimeout(copiedTimeoutId)
    copiedTimeoutId = null
  }
}

function resetToDefaults() {
  duration.value = 'never'
  indexable.value = true
  showFiles.value = true
  showMetadata.value = true
  showAuthorAvatar.value = true
  allowBranch.value = true
  resetCopiedState()
}

watch(targetChatSlug, (slug) => {
  if (!slug) {
    return
  }

  resetToDefaults()
})

watch(share, (nextShare) => {
  if (!nextShare) {
    resetToDefaults()

    return
  }

  duration.value = inferDurationFromExpiresAt(nextShare.expiresAt)
  indexable.value = nextShare.indexable
  showFiles.value = nextShare.showFiles
  showMetadata.value = nextShare.showMetadata
  showAuthorAvatar.value = nextShare.showAuthorAvatar
  allowBranch.value = nextShare.allowBranch
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
}, { immediate: true, flush: 'post' })

function close() {
  modal.value?.close()
}

function onModalClosed() {
  closeShareModal()
}

async function copyLinkToClipboard(
  url: string,
  options: { silent?: boolean } = {},
) {
  try {
    await navigator.clipboard.writeText(url)

    justCopied.value = true

    if (copiedTimeoutId) {
      clearTimeout(copiedTimeoutId)
    }

    copiedTimeoutId = setTimeout(() => {
      justCopied.value = false
      copiedTimeoutId = null
    }, 2000)
  } catch {
    if (options.silent) {
      return
    }

    useErrorMessage('Failed to copy link')
  }
}

async function onCopyLink() {
  if (!share.value?.url) {
    return
  }

  await copyLinkToClipboard(share.value.url)
}

async function onGenerate() {
  if (!targetChatSlug.value || isLoading.value) {
    return
  }

  const url = await createOrUpdateShare(targetChatSlug.value, {
    duration: duration.value,
    indexable: indexable.value,
    showFiles: showFiles.value,
    showMetadata: showMetadata.value,
    showAuthorAvatar: showAuthorAvatar.value,
    allowBranch: allowBranch.value,
  })

  if (!url) {
    return
  }

  await copyLinkToClipboard(url, { silent: true })
}

async function onRevoke() {
  if (!targetChatSlug.value || isLoading.value) {
    return
  }

  const result = await useConfirm({
    text: 'Stop sharing this chat?',
    alert: true,
    actions: ['Stop sharing'],
  })

  if (!result) {
    return
  }

  await revokeShare(targetChatSlug.value)
}

onBeforeUnmount(() => {
  if (copiedTimeoutId) {
    clearTimeout(copiedTimeoutId)
  }
})
</script>
