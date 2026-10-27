<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="memory-entry-modal"
      class="js-memory-entry-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      @close="onModalClosed"
    >
      <div class="modal-box max-w-2xl max-h-[85dvh] flex flex-col">
        <div class="mb-4 grid shrink-0 gap-2">
          <UiButton
            mode="neutral"
            ghost
            size="sm"
            icon-name="lucide:arrow-left"
            :text="backLabel"
            normal-case
            class="-ml-2 justify-self-start"
            data-testid="memory-entry-back"
            @click="open = false"
          />
          <div class="flex items-start justify-between gap-3">
            <h3
              :id="headingId"
              class="min-w-0 break-words text-xl font-bold"
              data-testid="memory-entry-title"
            >
              {{ heading }}
            </h3>
            <UiButton
              v-if="isViewVisible"
              mode="error"
              outline
              size="sm"
              icon-name="lucide:trash-2"
              text="Delete"
              icon-only-phone
              class="shrink-0"
              :disabled="isDeleting"
              data-testid="memory-entry-delete"
              @click="deleteEntry"
            />
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div
            v-if="isFormVisible"
            class="grid gap-4"
            data-testid="memory-entry-form"
          >
            <div class="grid gap-1">
              <label
                class="text-sm font-semibold"
                :for="titleInputId"
              >
                Title
              </label>
              <input
                :id="titleInputId"
                v-model="draftTitle"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isTitleErrorShown }"
                :aria-invalid="isTitleErrorShown"
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
                class="text-sm font-semibold"
                :for="descriptionInputId"
              >
                Summary
              </label>
              <input
                :id="descriptionInputId"
                v-model="draftDescription"
                type="text"
                class="input w-full rounded-lg"
                :class="{ 'input-error': isDescriptionErrorShown }"
                :aria-invalid="isDescriptionErrorShown"
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
                class="text-sm font-semibold"
                :for="bodyInputId"
              >
                Details
              </label>
              <textarea
                :id="bodyInputId"
                ref="textarea"
                v-model="draftBody"
                class="
                  textarea textarea-bordered rounded-box min-h-36 w-full
                  resize-none max-h-[50dvh] overflow-y-auto
                "
                :class="{ 'textarea-error': isBodyErrorShown }"
                :aria-invalid="isBodyErrorShown"
                :disabled="isSaving"
                :placeholder="bodyPlaceholder"
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
                class="text-sm font-semibold"
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
                  :disabled="isCategoryUnavailable(category)"
                >
                  {{ memoryCategoryLabels[category] }}
                </option>
              </select>
              <p
                v-for="category in blockedSingletonCategories"
                :key="category"
                class="text-xs text-base-content/70"
                data-testid="memory-entry-category-hint"
              >
                Edit your existing {{ memoryCategoryLabels[category] }}
                entry instead.
              </p>
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
            v-else-if="currentEntry"
            class="grid gap-5"
            data-testid="memory-entry-view"
          >
            <section class="grid gap-1">
              <h4 class="text-sm font-semibold">Last updated</h4>
              <p
                class="text-sm"
                data-testid="memory-entry-meta"
              >
                {{ updatedDateLabel }}
                <span class="text-base-content/70">· {{ updatedAgeLabel }}</span>
              </p>
            </section>
            <section class="grid gap-1">
              <h4 class="text-sm font-semibold">Summary</h4>
              <p
                class="break-words"
                data-testid="memory-entry-description"
              >
                {{ currentEntry.description }}
              </p>
            </section>
            <section class="grid gap-1">
              <h4 class="text-sm font-semibold">Details</h4>
              <div
                class="max-h-[min(360px,40dvh)] overflow-y-auto break-words"
                data-testid="memory-entry-body"
              >
                <MDCCached
                  :value="currentEntry.body"
                  :cache-key="bodyCacheKey"
                  :components="messageComponents"
                  :parser-options="{ highlight: false }"
                  class="chat-markdown text-sm"
                />
              </div>
            </section>
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
            <section
              class="grid gap-2"
              data-testid="memory-entry-sources"
            >
              <h4 class="text-sm font-semibold">Sources</h4>
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
        <div class="mt-4 flex shrink-0 justify-end gap-2">
          <template v-if="isFormVisible">
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
              :text="saveButtonText"
              :disabled="isSaveDisabled"
              data-testid="memory-entry-save"
              @click="saveEntry"
            />
          </template>
          <UiButton
            v-else
            size="sm"
            icon-name="lucide:pencil"
            text="Edit"
            :disabled="isDeleting"
            data-testid="memory-entry-edit"
            @click="startEditing"
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
import type {
  MemoryCategory,
  MemoryEntry,
  MemoryEntryPatch,
} from '#shared/types/memory.d'
import type { MemoryEntryLimits } from '#shared/types/memory-api.d'
import type {
  MemoryEntryInitialValues,
  MemoryEntryModalChange,
} from '~/types/memory-entries.d'

interface SourceChat {
  id: string
  slug: string
  title: string
}

type ParsedError = ReturnType<typeof parseError>

const props = withDefaults(defineProps<{
  entry: MemoryEntry | null
  limits: MemoryEntryLimits
  projectId?: string | null
  takenSingletonCategories?: MemoryCategory[]
  backLabel?: string
  initialValues?: MemoryEntryInitialValues | null
}>(), {
  projectId: null,
  initialValues: null,
  takenSingletonCategories: () => [],
  backLabel: 'Memory',
})

const emit = defineEmits<{
  changed: [change: MemoryEntryModalChange]
}>()

const open = defineModel<boolean>('open', { default: false })

const headingId = useId()
const titleInputId = useId()
const descriptionInputId = useId()
const bodyInputId = useId()
const categoryInputId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const { messageComponents } = useChatFormat()
const bodyPlaceholder = '- One fact per line\n- Markdown lists render as bullets'

const currentEntry = shallowRef<MemoryEntry | null>(props.entry)
const isEditing = shallowRef<boolean>(false)
const isSaving = shallowRef<boolean>(false)
const isDeleting = shallowRef<boolean>(false)
const saveError = shallowRef<ParsedError | null>(null)
const draftTitle = shallowRef<string>('')
const draftDescription = shallowRef<string>('')
const draftBody = shallowRef<string>('')
const { textarea } = useTextareaAutosize({ input: draftBody })
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

const isTitleErrorShown = computed<boolean>(() => {
  return isTitleOverLimit.value
    || (!isCreating.value && !normalizedTitle.value)
})

const isDescriptionErrorShown = computed<boolean>(() => {
  return isDescriptionOverLimit.value
    || (!isCreating.value && !normalizedDescription.value)
})

const isBodyErrorShown = computed<boolean>(() => {
  return isBodyOverLimit.value
    || (!isCreating.value && !draftBody.value.trim())
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

const isCreating = computed<boolean>(() => {
  return !currentEntry.value
})

const isFormVisible = computed<boolean>(() => {
  return isCreating.value || isEditing.value
})

const isViewVisible = computed<boolean>(() => {
  return !!currentEntry.value && !isEditing.value
})

const isSaveDisabled = computed<boolean>(() => {
  const hasNoChanges = !isCreating.value
    && Object.keys(changedFields.value).length === 0

  return isSaving.value
    || isTitleInvalid.value
    || isDescriptionInvalid.value
    || isBodyInvalid.value
    || hasNoChanges
})

const saveButtonText = computed<string>(() => {
  if (isSaving.value) {
    return 'Saving...'
  }

  return isCreating.value ? 'Save' : 'Save changes'
})

const blockedSingletonCategories = computed<MemoryCategory[]>(() => {
  if (!isCreating.value) {
    return []
  }

  return memoryCategoryOrder.filter((category) => {
    return isCategoryUnavailable(category)
  })
})

const heading = computed<string>(() => {
  if (isCreating.value) {
    return 'Add memory'
  }

  if (isEditing.value) {
    return 'Edit memory'
  }

  return currentEntry.value?.title ?? 'Memory'
})

const updatedDateLabel = computed<string>(() => {
  if (!currentEntry.value) {
    return ''
  }

  return new Date(currentEntry.value.updatedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
})

const updatedAgeLabel = computed<string>(() => {
  if (!currentEntry.value) {
    return ''
  }

  return formatMemoryUpdatedAge(new Date(currentEntry.value.updatedAt))
})

const bodyCacheKey = computed<string>(() => {
  const entry = currentEntry.value

  return [
    'memory-entry',
    entry?.id,
    entry?.updatedAt,
    entry?.body.length ?? 0,
  ].join(':')
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

function isCategoryUnavailable(category: MemoryCategory): boolean {
  if (category === currentEntry.value?.category) {
    return false
  }

  return props.takenSingletonCategories.includes(category)
}

function startCreating() {
  const initialValues = props.initialValues

  draftTitle.value = initialValues?.title ?? ''
  draftDescription.value = initialValues?.description ?? ''
  draftBody.value = initialValues?.body ?? ''
  draftCategory.value = initialValues?.category
    ?? (props.takenSingletonCategories.includes('profile')
      ? 'topics'
      : 'profile')
  saveError.value = null
}

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
  saveError.value = null

  if (isCreating.value) {
    open.value = false

    return
  }

  isEditing.value = false
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

const { handleConsentError } = useLegalConsent()

async function createEntry() {
  if (isSaveDisabled.value) {
    return
  }

  isSaving.value = true
  saveError.value = null

  try {
    await $fetch('/api/v1/memory/entries', {
      method: 'POST',
      body: {
        ...(props.projectId ? { projectId: props.projectId } : {}),
        category: draftCategory.value,
        title: normalizedTitle.value,
        description: normalizedDescription.value,
        body: draftBody.value,
      },
    })

    if (!props.initialValues) {
      useInfoMessage('Saved', 'Memory entry added.')
    }

    open.value = false
    emit('changed', { reason: 'created', categoryChanged: false })
  } catch (exception) {
    if (await handleConsentError(exception)) {
      return
    }

    saveError.value = parseError(exception)
  } finally {
    isSaving.value = false
  }
}

async function saveEntry() {
  if (isCreating.value) {
    await createEntry()

    return
  }

  await saveChanges()
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
    if (await handleConsentError(exception)) {
      return
    }

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
    if (isCreating.value) {
      startCreating()
    }

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
