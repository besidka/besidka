<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="memory-entry-modal"
      class="js-memory-entry-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      @close="onModalClosed"
    >
      <div class="modal-box max-w-2xl max-h-[80vh] flex flex-col">
        <div class="mb-4 flex shrink-0 items-start justify-between gap-2">
          <h3
            :id="headingId"
            class="min-w-0 break-words text-xl font-bold"
            data-testid="memory-entry-title"
          >
            {{ heading }}
          </h3>
          <form method="dialog">
            <button
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
              data-testid="memory-entry-modal-close"
            >
              <Icon name="lucide:x" size="16" />
            </button>
          </form>
        </div>
        <div
          v-if="currentEntry"
          class="flex-1 min-h-0 overflow-y-auto"
        >
          <div
            v-if="isEditing"
            class="grid gap-4"
            data-testid="memory-entry-form"
          >
            <div class="grid gap-1">
              <label
                class="text-sm font-bold"
                :for="titleInputId"
              >
                Title
              </label>
              <input
                :id="titleInputId"
                v-model="draftTitle"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isTitleInvalid }"
                :aria-invalid="isTitleInvalid"
                :disabled="isSaving"
                data-testid="memory-entry-title-input"
                @input="saveError = null"
              >
              <p
                class="text-xs"
                :class="isTitleOverLimit ? 'text-error' : 'text-base-content/70'"
                data-testid="memory-entry-title-counter"
              >
                {{ normalizedTitle.length }} / {{ limits.maxTitleChars }}
              </p>
            </div>
            <div class="grid gap-1">
              <label
                class="text-sm font-bold"
                :for="descriptionInputId"
              >
                Description
              </label>
              <input
                :id="descriptionInputId"
                v-model="draftDescription"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isDescriptionInvalid }"
                :aria-invalid="isDescriptionInvalid"
                :disabled="isSaving"
                data-testid="memory-entry-description-input"
                @input="saveError = null"
              >
              <p
                class="text-xs"
                :class="isDescriptionOverLimit
                  ? 'text-error'
                  : 'text-base-content/70'"
                data-testid="memory-entry-description-counter"
              >
                {{ normalizedDescription.length }}
                / {{ limits.maxDescriptionChars }}
              </p>
            </div>
            <div class="grid gap-1">
              <label
                class="text-sm font-bold"
                :for="bodyInputId"
              >
                Details
              </label>
              <textarea
                :id="bodyInputId"
                v-model="draftBody"
                class="
                  textarea textarea-bordered rounded-box min-h-40 w-full
                  resize-y max-h-[50dvh] overflow-y-auto
                "
                :class="{ 'textarea-error': isBodyInvalid }"
                :aria-invalid="isBodyInvalid"
                :disabled="isSaving"
                data-testid="memory-entry-body-input"
                @input="saveError = null"
              />
              <p
                class="text-xs"
                :class="isBodyOverLimit ? 'text-error' : 'text-base-content/70'"
                data-testid="memory-entry-body-counter"
              >
                {{ bodyByteCount }} / {{ bodyByteLimit }} bytes
              </p>
            </div>
            <div class="grid gap-1">
              <label
                class="text-sm font-bold"
                :for="categoryInputId"
              >
                Category
              </label>
              <select
                :id="categoryInputId"
                v-model="draftCategory"
                class="select w-full rounded-lg"
                :disabled="isSaving"
                data-testid="memory-entry-category-select"
                @change="saveError = null"
              >
                <option
                  v-for="category in memoryCategoryOrder"
                  :key="category"
                  :value="category"
                >
                  {{ memoryCategoryLabels[category] }}
                </option>
              </select>
            </div>
            <div
              v-if="saveError"
              role="alert"
              class="alert alert-soft alert-error !items-start"
              data-testid="memory-entry-error"
            >
              <Icon
                name="lucide:circle-alert"
                size="20"
                class="mt-0.5 shrink-0"
              />
              <div class="grid min-w-0 gap-1">
                <p class="font-bold break-words">{{ saveError.message }}</p>
                <p v-if="saveError.why" class="text-sm break-words">
                  {{ saveError.why }}
                </p>
                <p v-if="saveError.fix" class="text-sm break-words">
                  {{ saveError.fix }}
                </p>
              </div>
            </div>
          </div>
          <div
            v-else
            class="grid gap-4"
            data-testid="memory-entry-view"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="badge badge-soft"
                data-testid="memory-entry-category"
              >
                {{ memoryCategoryLabels[currentEntry.category] }}
              </span>
              <span
                class="badge badge-outline"
                data-testid="memory-entry-origin"
              >
                {{ getMemoryEntryOriginLabel(currentEntry.origin) }}
              </span>
            </div>
            <p
              class="font-bold break-words"
              data-testid="memory-entry-description"
            >
              {{ currentEntry.description }}
            </p>
            <p
              class="whitespace-pre-wrap break-words"
              data-testid="memory-entry-body"
            >
              {{ currentEntry.body }}
            </p>
            <p
              class="text-sm text-base-content/70"
              data-testid="memory-entry-meta"
            >
              {{ updatedLabel }} · Created {{ createdLabel }}
            </p>
            <section
              class="grid gap-2"
              data-testid="memory-entry-sources"
            >
              <h4 class="text-sm font-bold">Sources</h4>
              <p
                v-if="!hasSourceIds"
                class="text-sm text-base-content/70"
                data-testid="memory-entry-sources-empty"
              >
                Not tied to a specific chat.
              </p>
              <div
                v-else-if="isLoadingSources"
                class="grid gap-2"
                data-testid="memory-entry-sources-skeleton"
              >
                <div class="skeleton skeleton--default h-5 w-2/3 rounded-lg" />
                <div class="skeleton skeleton--default h-5 w-1/2 rounded-lg" />
              </div>
              <div
                v-else-if="sourcesError"
                role="alert"
                class="alert alert-soft alert-error !items-start"
                data-testid="memory-entry-sources-error"
              >
                <Icon
                  name="lucide:circle-alert"
                  size="20"
                  class="mt-0.5 shrink-0"
                />
                <div class="grid gap-1">
                  <p class="font-bold">{{ sourcesError.message }}</p>
                  <p v-if="sourcesError.why" class="text-sm">
                    {{ sourcesError.why }}
                  </p>
                </div>
              </div>
              <template v-else>
                <ul
                  v-if="sourceChats.length"
                  class="grid gap-1"
                >
                  <li
                    v-for="chat in sourceChats"
                    :key="chat.id"
                    class="min-w-0"
                  >
                    <NuxtLink
                      :to="`/chats/${chat.slug}`"
                      class="link break-words"
                      data-testid="memory-entry-source-link"
                      @click="open = false"
                    >
                      {{ chat.title || 'Untitled chat' }}
                    </NuxtLink>
                  </li>
                </ul>
                <p
                  v-if="missingSourceCount > 0"
                  class="text-sm text-base-content/70"
                  data-testid="memory-entry-sources-missing"
                >
                  {{ missingSourceLabel }}
                </p>
              </template>
            </section>
          </div>
        </div>
        <div
          v-if="currentEntry"
          class="mt-4 flex shrink-0 justify-end gap-2"
        >
          <template v-if="isEditing">
            <UiButton
              mode="neutral"
              ghost
              size="sm"
              text="Cancel"
              :disabled="isSaving"
              data-testid="memory-entry-cancel"
              @click="cancelEditing"
            />
            <UiButton
              size="sm"
              :text="isSaving ? 'Saving...' : 'Save changes'"
              :disabled="isSaveDisabled"
              data-testid="memory-entry-save"
              @click="saveChanges"
            />
          </template>
          <template v-else>
            <UiButton
              mode="error"
              outline
              size="sm"
              icon-name="lucide:trash-2"
              text="Delete"
              :disabled="isDeleting"
              data-testid="memory-entry-delete"
              @click="deleteEntry"
            />
            <UiButton
              size="sm"
              icon-name="lucide:pencil"
              text="Edit"
              :disabled="isDeleting"
              data-testid="memory-entry-edit"
              @click="startEditing"
            />
          </template>
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
import type {
  MemoryCategory,
  MemoryEntry,
  MemoryEntryPatch,
} from '#shared/types/memory.d'
import type {
  MemoryEntryChange,
  MemoryEntryLimits,
} from '#shared/types/memory-api.d'

interface SourceChat {
  id: string
  slug: string
  title: string
}

type ParsedError = ReturnType<typeof parseError>

const props = defineProps<{
  entry: MemoryEntry | null
  limits: MemoryEntryLimits
}>()

const emit = defineEmits<{
  changed: [change: MemoryEntryChange]
}>()

const open = defineModel<boolean>('open', { default: false })

const headingId = useId()
const titleInputId = useId()
const descriptionInputId = useId()
const bodyInputId = useId()
const categoryInputId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')

const currentEntry = shallowRef<MemoryEntry | null>(props.entry)
const isEditing = shallowRef<boolean>(false)
const isSaving = shallowRef<boolean>(false)
const isDeleting = shallowRef<boolean>(false)
const saveError = shallowRef<ParsedError | null>(null)
const draftTitle = shallowRef<string>('')
const draftDescription = shallowRef<string>('')
const draftBody = shallowRef<string>('')
const draftCategory = shallowRef<MemoryCategory>('topics')
const sourceChats = shallowRef<SourceChat[]>([])
const isLoadingSources = shallowRef<boolean>(false)
const sourcesError = shallowRef<ParsedError | null>(null)

let sourcesRequestToken = 0
let sourcesLoadedForId: string | null = null

function normalizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

const normalizedTitle = computed<string>(() => {
  return normalizeSingleLine(draftTitle.value)
})

const normalizedDescription = computed<string>(() => {
  return normalizeSingleLine(draftDescription.value)
})

const bodyByteCount = computed<number>(() => {
  return memoryByteLength(draftBody.value)
})

const bodyByteLimit = computed<number>(() => {
  const isAlwaysInjected = (alwaysInjectedMemoryCategories as readonly string[])
    .includes(draftCategory.value)

  return isAlwaysInjected
    ? props.limits.maxAlwaysInjectedBodyBytes
    : props.limits.maxBodyBytes
})

const isTitleOverLimit = computed<boolean>(() => {
  return normalizedTitle.value.length > props.limits.maxTitleChars
})

const isDescriptionOverLimit = computed<boolean>(() => {
  return normalizedDescription.value.length > props.limits.maxDescriptionChars
})

const isBodyOverLimit = computed<boolean>(() => {
  return bodyByteCount.value > bodyByteLimit.value
})

const isTitleInvalid = computed<boolean>(() => {
  return isTitleOverLimit.value || !normalizedTitle.value
})

const isDescriptionInvalid = computed<boolean>(() => {
  return isDescriptionOverLimit.value || !normalizedDescription.value
})

const isBodyInvalid = computed<boolean>(() => {
  return isBodyOverLimit.value || !draftBody.value.trim()
})

const changedFields = computed<MemoryEntryPatch>(() => {
  const entry = currentEntry.value
  const changes: MemoryEntryPatch = {}

  if (!entry) {
    return changes
  }

  if (normalizedTitle.value !== entry.title) {
    changes.title = normalizedTitle.value
  }

  if (normalizedDescription.value !== entry.description) {
    changes.description = normalizedDescription.value
  }

  if (draftBody.value !== entry.body) {
    changes.body = draftBody.value
  }

  if (draftCategory.value !== entry.category) {
    changes.category = draftCategory.value
  }

  return changes
})

const isSaveDisabled = computed<boolean>(() => {
  return isSaving.value
    || isTitleInvalid.value
    || isDescriptionInvalid.value
    || isBodyInvalid.value
    || Object.keys(changedFields.value).length === 0
})

const heading = computed<string>(() => {
  if (isEditing.value) {
    return 'Edit memory'
  }

  return currentEntry.value?.title ?? 'Memory'
})

const updatedLabel = computed<string>(() => {
  if (!currentEntry.value) {
    return ''
  }

  const age = formatMemoryUpdatedAge(new Date(currentEntry.value.updatedAt))

  return `Updated ${age}`
})

const createdLabel = computed<string>(() => {
  if (!currentEntry.value) {
    return ''
  }

  return new Date(currentEntry.value.createdAt)
    .toLocaleDateString(undefined, { dateStyle: 'medium' })
})

const hasSourceIds = computed<boolean>(() => {
  return (currentEntry.value?.sourceChatIds.length ?? 0) > 0
})

const missingSourceCount = computed<number>(() => {
  const sourceCount = currentEntry.value?.sourceChatIds.length ?? 0

  return Math.max(0, sourceCount - sourceChats.value.length)
})

const missingSourceLabel = computed<string>(() => {
  const count = missingSourceCount.value

  return count === 1
    ? '1 source chat no longer exists.'
    : `${count} source chats no longer exist.`
})

function resetState() {
  isEditing.value = false
  saveError.value = null
  sourcesRequestToken += 1
  sourcesLoadedForId = null
  sourceChats.value = []
  isLoadingSources.value = false
  sourcesError.value = null
}

function startEditing() {
  const entry = currentEntry.value

  if (!entry) {
    return
  }

  draftTitle.value = entry.title
  draftDescription.value = normalizeSingleLine(entry.description)
  draftBody.value = entry.body
  draftCategory.value = entry.category
  saveError.value = null
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
  saveError.value = null
}

async function loadSources(entry: MemoryEntry) {
  sourcesLoadedForId = entry.id
  sourcesRequestToken += 1

  const requestToken = sourcesRequestToken

  isLoadingSources.value = true
  sourcesError.value = null
  sourceChats.value = []

  try {
    const response = await $fetch(
      `/api/v1/memory/entries/${entry.id}/sources`,
    )

    if (requestToken !== sourcesRequestToken) {
      return
    }

    sourceChats.value = response.chats
  } catch (exception) {
    if (requestToken !== sourcesRequestToken) {
      return
    }

    sourcesError.value = parseError(exception)
  } finally {
    if (requestToken === sourcesRequestToken) {
      isLoadingSources.value = false
    }
  }
}

async function saveChanges() {
  const entry = currentEntry.value

  if (!entry || isSaveDisabled.value) {
    return
  }

  isSaving.value = true
  saveError.value = null

  try {
    const response = await $fetch(`/api/v1/memory/entries/${entry.id}`, {
      method: 'PATCH',
      body: changedFields.value,
    })

    if (currentEntry.value?.id === entry.id) {
      currentEntry.value = response.entry
      isEditing.value = false
    }

    useInfoMessage('Saved', 'Memory entry updated.')
    emit('changed', {
      reason: 'saved',
      categoryChanged: response.entry.category !== entry.category,
    })
  } catch (exception) {
    if (currentEntry.value?.id === entry.id) {
      saveError.value = parseError(exception)
    }
  } finally {
    isSaving.value = false
  }
}

async function deleteEntry() {
  const entry = currentEntry.value

  if (!entry || isDeleting.value) {
    return
  }

  const result = await useConfirm({
    text: 'Delete this memory?',
    subtitle: 'Besidka stops using it in chats. This cannot be undone.',
    alert: true,
    actions: ['Delete'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isDeleting.value = true

  try {
    await $fetch(`/api/v1/memory/entries/${entry.id}`, {
      method: 'DELETE',
    })

    useInfoMessage('Deleted', 'Memory entry removed.')
    open.value = false
    emit('changed', { reason: 'deleted', categoryChanged: false })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to delete the entry.',
      parsedException.why,
    )
  } finally {
    isDeleting.value = false
  }
}

function onModalClosed() {
  open.value = false
}

watch(() => props.entry, (entry, previousEntry) => {
  if (entry?.id !== previousEntry?.id) {
    resetState()
  }

  currentEntry.value = entry
})

watch(open, (isOpen) => {
  if (!modal.value) {
    return
  }

  if (isOpen) {
    modal.value.showModal()

    return
  }

  resetState()
  modal.value.close()
}, { immediate: true, flush: 'post' })

watch(
  [open, () => currentEntry.value?.id],
  ([isOpen]) => {
    const entry = currentEntry.value

    if (!isOpen || !entry || !hasSourceIds.value) {
      return
    }

    if (sourcesLoadedForId === entry.id) {
      return
    }

    loadSources(entry)
  },
  { immediate: true, flush: 'post' },
)
</script>
