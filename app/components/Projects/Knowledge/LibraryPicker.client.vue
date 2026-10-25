<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-knowledge-library-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="knowledge-library-modal"
      @close="onModalClosed"
    >
      <div class="modal-box flex max-h-[85dvh] max-w-2xl flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
          >
            Add from my library
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="knowledge-library-close"
            >
              <Icon
                name="lucide:x"
                size="16"
              />
            </button>
          </form>
        </div>
        <div class="mb-3 grid shrink-0 gap-1">
          <label
            class="text-sm font-semibold"
            :for="searchInputId"
          >
            Search PDFs and images
          </label>
          <input
            :id="searchInputId"
            v-model="search"
            type="search"
            class="input w-full rounded-lg"
            placeholder="File name"
            data-testid="knowledge-library-search"
          >
        </div>
        <div class="-me-2 min-h-0 flex-1 overflow-y-auto pe-2">
          <div
            v-if="isLoading && files.length === 0"
            class="grid gap-2"
            data-testid="knowledge-library-skeleton"
          >
            <div class="skeleton skeleton--default h-10 w-full" />
            <div class="skeleton skeleton--default h-10 w-full" />
            <div class="skeleton skeleton--default h-10 w-full" />
          </div>
          <div
            v-else-if="loadError"
            role="alert"
            class="alert alert-soft alert-error !items-start"
            data-testid="knowledge-library-error"
          >
            <Icon
              name="lucide:circle-alert"
              size="20"
              class="mt-0.5 shrink-0"
            />
            <div class="grid min-w-0 gap-1">
              <p class="break-words font-bold">{{ loadError.message }}</p>
              <p
                v-if="loadError.why"
                class="break-words text-sm"
              >
                {{ loadError.why }}
              </p>
            </div>
          </div>
          <p
            v-else-if="files.length === 0"
            class="rounded-box bg-base-200/60 px-4 py-3 text-sm opacity-70"
            data-testid="knowledge-library-empty"
          >
            No PDFs or images found in your library.
          </p>
          <ul
            v-else
            class="grid gap-1"
            aria-label="Library files"
          >
            <li
              v-for="file in files"
              :key="file.id"
            >
              <label
                class="
                  rounded-box flex cursor-pointer items-center gap-3 p-3
                  hover:bg-base-content/5
                "
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  :checked="selectedIds.includes(file.id)"
                  :data-testid="`knowledge-library-file-${file.id}`"
                  @change="toggle(file.id)"
                >
                <span class="min-w-0 flex-1 truncate font-medium">
                  {{ file.name }}
                </span>
                <span class="shrink-0 text-xs text-base-content/60">
                  {{ formatKnowledgeBytes(file.size) }}
                </span>
              </label>
            </li>
          </ul>
          <div
            v-if="hasMore"
            class="mt-3 flex justify-center"
          >
            <button
              type="button"
              class="btn btn-sm"
              :disabled="isLoading"
              data-testid="knowledge-library-more"
              @click="loadMore"
            >
              <span
                v-if="isLoading"
                class="loading loading-spinner loading-xs"
              />
              <span v-else>Load more</span>
            </button>
          </div>
        </div>
        <div class="mt-4 flex shrink-0 justify-end gap-2">
          <UiButton
            mode="neutral"
            ghost
            size="sm"
            text="Cancel"
            normal-case
            data-testid="knowledge-library-cancel"
            @click="open = false"
          />
          <UiButton
            size="sm"
            normal-case
            :text="addLabel"
            :disabled="selectedIds.length === 0"
            data-testid="knowledge-library-add"
            @click="confirm"
          />
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
import { parseError } from 'evlog'
import type { KnowledgeLibraryFile } from '~/types/knowledge-ui.d'
import type { ProjectKnowledgeError } from '~/types/project-knowledge.d'

const emit = defineEmits<{
  select: [files: KnowledgeLibraryFile[]]
}>()

const open = defineModel<boolean>('open', { default: false })

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]

const headingId = useId()
const searchInputId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const files = shallowRef<KnowledgeLibraryFile[]>([])
const selectedIds = shallowRef<string[]>([])
const search = shallowRef<string>('')
const isLoading = shallowRef<boolean>(false)
const loadError = shallowRef<ProjectKnowledgeError | null>(null)
const serverOffset = shallowRef<number>(0)
const total = shallowRef<number>(0)

let requestToken = 0

const hasMore = computed<boolean>(() => {
  return serverOffset.value < total.value
})

const addLabel = computed<string>(() => {
  const count = selectedIds.value.length

  if (count === 0) {
    return 'Add files'
  }

  return count === 1 ? 'Add 1 file' : `Add ${count} files`
})

async function fetchPage(offset: number) {
  requestToken += 1

  const token = requestToken

  isLoading.value = true
  loadError.value = null

  try {
    const response = await $fetch('/api/v1/files', {
      query: {
        offset,
        limit: PAGE_SIZE,
        source: 'upload',
        ...(search.value.trim() ? { search: search.value.trim() } : {}),
      },
    })

    if (token !== requestToken) {
      return
    }

    const allowedFiles = response.files.filter((file) => {
      return ALLOWED_TYPES.includes(file.type)
    })

    files.value = offset === 0
      ? allowedFiles
      : [...files.value, ...allowedFiles]
    serverOffset.value = offset + response.files.length
    total.value = response.total
  } catch (exception) {
    if (token === requestToken) {
      loadError.value = parseError(exception)
    }
  } finally {
    if (token === requestToken) {
      isLoading.value = false
    }
  }
}

function loadMore() {
  fetchPage(serverOffset.value)
}

function toggle(fileId: string) {
  selectedIds.value = selectedIds.value.includes(fileId)
    ? selectedIds.value.filter(id => id !== fileId)
    : [...selectedIds.value, fileId]
}

function confirm() {
  const chosenFiles = files.value.filter((file) => {
    return selectedIds.value.includes(file.id)
  })

  open.value = false
  emit('select', chosenFiles)
}

function onModalClosed() {
  open.value = false
}

const debouncedReload = useDebounceFn(() => {
  fetchPage(0)
}, SEARCH_DEBOUNCE_MS)

watch(search, () => {
  if (open.value) {
    debouncedReload()
  }
})

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    selectedIds.value = []
    search.value = ''
    files.value = []
    serverOffset.value = 0
    total.value = 0
    modal.value.showModal()
    fetchPage(0)

    return
  }

  requestToken += 1
  modal.value.close()
}, { immediate: true, flush: 'post' })
</script>
