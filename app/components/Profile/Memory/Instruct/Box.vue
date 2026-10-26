<template>
  <section
    class="grid gap-2"
    data-testid="memory-instruct"
  >
    <label
      :for="textareaId"
      class="text-sm font-semibold"
    >
      Tell Besidka what to remember or change
    </label>
    <textarea
      :id="textareaId"
      ref="textarea"
      v-model="text"
      class="
        textarea textarea-bordered rounded-box min-h-20 w-full resize-none
        max-h-[40dvh] overflow-y-auto
      "
      :class="{ 'textarea-error': isOverLimit }"
      :aria-invalid="isOverLimit"
      :aria-describedby="hintId"
      :disabled="isBusy"
      :placeholder="placeholder"
      data-testid="memory-instruct-text"
    />
    <div
      class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
    >
      <p
        :id="hintId"
        class="min-w-0 text-xs text-base-content/70"
        data-testid="memory-instruct-hint"
      >
        <span
          v-if="modelLabel"
          data-testid="memory-instruct-model"
        >{{ modelLabel }} · </span>Runs once on your own API key.
        <span
          :class="{ 'text-error': isOverLimit }"
          data-testid="memory-instruct-counter"
        >{{ text.length }} / {{ maxChars }}</span>
      </p>
      <UiButton
        size="sm"
        normal-case
        text="Preview changes"
        class="shrink-0 max-sm:w-full"
        :disabled="isPreviewDisabled"
        data-testid="memory-instruct-preview"
        @click="runPreview"
      >
        <template #icon>
          <span
            v-if="isPreviewing"
            class="loading loading-spinner loading-xs"
          />
          <Icon
            v-else
            name="lucide:wand-sparkles"
            size="16"
          />
        </template>
      </UiButton>
    </div>
    <div
      v-if="warning"
      role="status"
      class="alert alert-soft alert-warning !items-start"
      data-testid="memory-instruct-warning"
    >
      <Icon
        name="lucide:clock"
        size="20"
        class="mt-0.5 shrink-0"
      />
      <div class="grid min-w-0 gap-1">
        <p class="font-bold break-words">{{ warning.message }}</p>
        <p v-if="warning.why" class="text-sm break-words">{{ warning.why }}</p>
      </div>
    </div>
    <div
      v-if="error"
      role="alert"
      class="alert alert-soft alert-error !items-start"
      data-testid="memory-instruct-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="20"
        class="mt-0.5 shrink-0"
      />
      <div class="grid min-w-0 gap-1">
        <p class="font-bold break-words">{{ error.message }}</p>
        <p v-if="error.why" class="text-sm break-words">{{ error.why }}</p>
        <p v-if="error.fix" class="text-sm break-words">{{ error.fix }}</p>
      </div>
    </div>
    <div
      v-if="preview"
      class="grid gap-3 rounded-box border border-base-content/10 p-3"
      data-testid="memory-instruct-result"
    >
      <p
        v-if="preview.operations.length === 0"
        class="text-sm text-base-content/70"
        data-testid="memory-instruct-empty"
      >
        Nothing to change. Try saying it differently.
      </p>
      <ProfileMemoryInstructPreview
        v-else
        v-model:selected="selectedKeys"
        :operations="preview.operations"
      />
      <p
        v-if="blockedTotal > 0"
        class="text-xs text-base-content/70"
        data-testid="memory-instruct-blocked"
      >
        {{ blockedTotal }} private
        {{ blockedTotal === 1 ? 'detail was' : 'details were' }}
        removed before reading and never saved.
      </p>
      <p
        v-if="overCapacityBy > 0"
        class="text-sm text-warning"
        role="status"
        data-testid="memory-instruct-capacity"
      >
        That is {{ overCapacityBy }} more than the {{ preview.capacity.limit }}
        entries memory can hold. Untick a new entry or tick a removal.
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <UiButton
          mode="neutral"
          ghost
          size="sm"
          normal-case
          text="Cancel"
          :disabled="isApplying"
          data-testid="memory-instruct-cancel"
          @click="cancelPreview"
        />
        <UiButton
          v-if="preview.operations.length > 0"
          size="sm"
          normal-case
          class="min-w-36"
          :text="applyText"
          :disabled="isApplyDisabled"
          data-testid="memory-instruct-apply"
          @click="runApply"
        >
          <template
            v-if="isApplying"
            #icon
          >
            <span class="loading loading-spinner loading-xs" />
          </template>
        </UiButton>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type {
  MemoryInstructApplyResponse,
  MemoryInstructPreviewOperation,
  MemoryInstructPreviewResponse,
} from '#shared/types/memory-instruct.d'
import { MEMORY_INSTRUCT_LIMITS } from '#shared/utils/memory-instruct'
import type { MemoryInstructApplyOperation } from '#shared/utils/memory-instruct'

type ParsedError = ReturnType<typeof parseError>

interface InstructWarning {
  message: string
  why: string | null
}

const props = withDefaults(defineProps<{
  projectId?: string | null
  modelId?: string | null
}>(), {
  projectId: null,
  modelId: null,
})

const emit = defineEmits<{
  changed: []
}>()

const RATE_LIMIT_STATUS = 429
const RATE_LIMIT_MESSAGE = 'Wait a moment before trying again'

const maxChars = MEMORY_INSTRUCT_LIMITS.maxTextChars

const textareaId = useId()
const hintId = useId()

const text = shallowRef<string>('')
const { textarea } = useTextareaAutosize({ input: text })
const isPreviewing = shallowRef<boolean>(false)
const isApplying = shallowRef<boolean>(false)
const preview = shallowRef<MemoryInstructPreviewResponse | null>(null)
const selectedKeys = shallowRef<string[]>([])
const error = shallowRef<ParsedError | null>(null)
const warning = shallowRef<InstructWarning | null>(null)

const placeholder = computed<string>(() => {
  return props.projectId
    ? 'For example: the deadline is 15 Nov, we switched to Postgres'
    : 'For example: I moved to Kraków. Forget the coffee thing.'
})

const isBusy = computed<boolean>(() => {
  return isPreviewing.value || isApplying.value
})

const isOverLimit = computed<boolean>(() => {
  return text.value.length > maxChars
})

const isPreviewDisabled = computed<boolean>(() => {
  return isBusy.value || isOverLimit.value || text.value.trim() === ''
})

const modelLabel = computed<string | null>(() => {
  if (preview.value) {
    return preview.value.model.modelName
  }

  if (!props.modelId) {
    return null
  }

  return getModel(props.modelId).model?.name ?? props.modelId
})

const selectedOperations = computed<MemoryInstructPreviewOperation[]>(() => {
  return (preview.value?.operations ?? []).filter((operation) => {
    return operation.status === 'ready'
      && selectedKeys.value.includes(operation.key)
  })
})

const overCapacityBy = computed<number>(() => {
  if (!preview.value) {
    return 0
  }

  const { total, limit } = preview.value.capacity
  const delta = selectedOperations.value.reduce((sum, operation) => {
    if (operation.kind === 'create') {
      return sum + 1
    }

    return operation.kind === 'delete' ? sum - 1 : sum
  }, 0)

  return Math.max(0, total + delta - limit)
})

const blockedTotal = computed<number>(() => {
  return Object.values(preview.value?.blocked ?? {}).reduce((sum, count) => {
    return sum + (count ?? 0)
  }, 0)
})

const applyText = computed<string>(() => {
  const count = selectedOperations.value.length

  return `Apply ${count} ${count === 1 ? 'change' : 'changes'}`
})

const isApplyDisabled = computed<boolean>(() => {
  return isBusy.value
    || selectedOperations.value.length === 0
    || overCapacityBy.value > 0
})

function readRetryAfterSeconds(exception: unknown): number | null {
  const headers = (exception as {
    response?: { headers?: { get?: (name: string) => string | null } }
  } | null)?.response?.headers
  const header = headers?.get?.('retry-after')
  const seconds = Number(header)

  if (!header || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return Math.ceil(seconds)
}

function handleRequestError(exception: unknown) {
  const parsedException = parseError(exception)

  if (parsedException.status !== RATE_LIMIT_STATUS) {
    error.value = parsedException

    return
  }

  const seconds = readRetryAfterSeconds(exception)

  warning.value = {
    message: RATE_LIMIT_MESSAGE,
    why: seconds === null
      ? parsedException.why ?? null
      : `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
  }
}

function defaultSelection(response: MemoryInstructPreviewResponse): string[] {
  return response.operations
    .filter((operation) => {
      return operation.status === 'ready' && operation.kind !== 'delete'
    })
    .map(operation => operation.key)
}

const { ensureSendConsent, handleConsentError } = useLegalConsent()

async function runPreview() {
  if (isPreviewDisabled.value) {
    return
  }

  if (!await ensureSendConsent(null)) {
    return
  }

  isPreviewing.value = true
  error.value = null
  warning.value = null

  try {
    const response = await $fetch('/api/v1/memory/instruct/preview', {
      method: 'POST',
      body: {
        text: text.value,
        ...(props.projectId ? { projectId: props.projectId } : {}),
      },
    })

    preview.value = response
    selectedKeys.value = defaultSelection(response)
  } catch (exception) {
    if (await handleConsentError(exception)) {
      return
    }

    handleRequestError(exception)
  } finally {
    isPreviewing.value = false
  }
}

function toApplyOperation(
  operation: MemoryInstructPreviewOperation,
): MemoryInstructApplyOperation | null {
  if (operation.kind === 'create' && operation.after) {
    return {
      kind: 'create',
      category: operation.category,
      ...operation.after,
    }
  }

  if (!operation.id || !operation.updatedAt) {
    return null
  }

  if (operation.kind === 'update' && operation.after) {
    return {
      kind: 'update',
      id: operation.id,
      updatedAt: operation.updatedAt,
      ...operation.after,
    }
  }

  if (operation.kind === 'delete') {
    return {
      kind: 'delete',
      id: operation.id,
      updatedAt: operation.updatedAt,
    }
  }

  return null
}

function announceApplied(response: MemoryInstructApplyResponse) {
  const summary = `Memory updated: ${response.created} added, `
    + `${response.updated} updated, ${response.deleted} removed`

  if (response.skipped > 0) {
    useWarningMessage(
      summary,
      `${response.skipped} ${response.skipped === 1
        ? 'change was'
        : 'changes were'} skipped because memory changed meanwhile.`,
    )

    return
  }

  useSuccessMessage(summary)
}

async function runApply() {
  if (isApplyDisabled.value || !preview.value) {
    return
  }

  const operations = selectedOperations.value
    .map(toApplyOperation)
    .filter((operation): operation is MemoryInstructApplyOperation => {
      return operation !== null
    })

  isApplying.value = true
  error.value = null
  warning.value = null

  try {
    const response = await $fetch('/api/v1/memory/instruct/apply', {
      method: 'POST',
      body: {
        operations,
        ...(props.projectId ? { projectId: props.projectId } : {}),
      },
    })

    announceApplied(response)
    preview.value = null
    selectedKeys.value = []
    text.value = ''
    emit('changed')
  } catch (exception) {
    if (await handleConsentError(exception)) {
      return
    }

    handleRequestError(exception)
  } finally {
    isApplying.value = false
  }
}

function cancelPreview() {
  preview.value = null
  selectedKeys.value = []
  error.value = null
  warning.value = null
}

watch(text, () => {
  if (!preview.value || isBusy.value) {
    return
  }

  preview.value = null
  selectedKeys.value = []
})
</script>
