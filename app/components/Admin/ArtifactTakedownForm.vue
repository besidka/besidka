<template>
  <form
    class="bubble rounded-box grid gap-3 p-4"
    data-testid="admin-takedown-form"
    @submit.prevent="onSubmit"
  >
    <h3 class="font-medium">
      Take down without a report
    </h3>
    <label
      class="grid gap-1"
      :for="`${formId}-target`"
    >
      <span class="text-sm">Link, token, artifact id, user id or email</span>
    </label>
    <input
      :id="`${formId}-target`"
      v-model="target"
      type="text"
      class="input w-full"
      autocomplete="off"
      spellcheck="false"
      :maxlength="TARGET_MAX_LENGTH"
      data-testid="admin-takedown-target"
    >
    <label
      class="grid gap-1"
      :for="`${formId}-scope`"
    >
      <span class="text-sm">Scope</span>
    </label>
    <select
      :id="`${formId}-scope`"
      v-model="scope"
      class="select w-full"
      data-testid="admin-takedown-scope"
    >
      <option
        v-for="value in ARTIFACT_TAKEDOWN_SCOPES"
        :key="value"
        :value="value"
      >
        {{ TAKEDOWN_SCOPE_LABELS[value] }}
      </option>
    </select>
    <label
      class="grid gap-1"
      :for="`${formId}-statement`"
    >
      <span class="text-sm">Statement of reasons (sent to the owner)</span>
    </label>
    <textarea
      :id="`${formId}-statement`"
      v-model="statement"
      class="textarea w-full"
      rows="4"
      :maxlength="ARTIFACT_TAKEDOWN_STATEMENT_MAX"
      :aria-describedby="`${formId}-statement-count`"
      data-testid="admin-takedown-statement"
    />
    <p
      :id="`${formId}-statement-count`"
      class="text-xs text-base-content/70"
      aria-live="polite"
    >
      {{ statementLength }} / {{ ARTIFACT_TAKEDOWN_STATEMENT_MAX }}
      (at least {{ ARTIFACT_TAKEDOWN_STATEMENT_MIN }})
    </p>
    <label class="label min-h-6 cursor-pointer items-start gap-2 text-sm whitespace-normal text-base-content">
      <input
        v-model="legalHold"
        type="checkbox"
        class="checkbox checkbox-sm mt-0.5 shrink-0"
        data-testid="admin-takedown-legal-hold"
      >
      <span>Keep for 6 months (removal order)</span>
    </label>
    <div class="flex justify-end">
      <button
        type="submit"
        class="btn btn-error btn-sm"
        :disabled="!canSubmit || isSubmitting"
        data-testid="admin-takedown-submit"
      >
        Take down
      </button>
    </div>
    <div
      v-if="result"
      class="alert alert-soft items-start text-sm"
      role="status"
      data-testid="admin-takedown-result"
    >
      <div class="grid min-w-0 grow gap-1">
        <p>
          Taken down: {{ result.takenDown }}.
          Already taken down: {{ result.alreadyTakenDown }}.
        </p>
        <p
          v-if="result.legalHoldUntil"
          class="text-xs"
        >
          Legal hold until
          <UiLocalDate :value="result.legalHoldUntil" />
        </p>
        <ul class="flex flex-wrap gap-1">
          <li v-if="result.shareId">
            <button
              type="button"
              class="btn btn-xs"
              :disabled="isRestoring"
              @click="onRestore({ shareId: result.shareId })"
            >
              Restore link {{ result.shareId }}
            </button>
          </li>
          <template v-else>
            <li
              v-for="artifactId in result.artifactIds"
              :key="artifactId"
            >
              <button
                type="button"
                class="btn btn-xs"
                :disabled="isRestoring"
                @click="onRestore({ artifactId })"
              >
                Restore {{ artifactId }}
              </button>
            </li>
          </template>
        </ul>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { ArtifactTakedownScope } from '#shared/utils/artifacts'
import {
  ARTIFACT_TAKEDOWN_SCOPES,
  ARTIFACT_TAKEDOWN_STATEMENT_MAX,
  ARTIFACT_TAKEDOWN_STATEMENT_MIN,
} from '#shared/utils/artifacts'
import { TAKEDOWN_SCOPE_LABELS } from '~/utils/admin-artifact-reports'

interface TakedownResult {
  scope: ArtifactTakedownScope
  takenDown: number
  alreadyTakenDown: number
  artifactIds: string[]
  shareId: string | null
  legalHoldUntil: string | null
}

type RestoreTarget = { artifactId: string } | { shareId: string }

const emit = defineEmits<{
  changed: []
}>()

const TARGET_MAX_LENGTH = 2048
const TAKEDOWN_ACTION = 'Take down'
const RESTORE_ACTION = 'Restore'

const formId = useId()
const target = shallowRef<string>('')
const scope = shallowRef<ArtifactTakedownScope>('artifact')
const statement = shallowRef<string>('')
const legalHold = shallowRef<boolean>(false)
const isSubmitting = shallowRef<boolean>(false)
const isRestoring = shallowRef<boolean>(false)
const result = shallowRef<TakedownResult | null>(null)

const statementLength = computed<number>(() => {
  return statement.value.trim().length
})

const canSubmit = computed<boolean>(() => {
  return !!target.value.trim()
    && statementLength.value >= ARTIFACT_TAKEDOWN_STATEMENT_MIN
    && statementLength.value <= ARTIFACT_TAKEDOWN_STATEMENT_MAX
})

function showError(exception: unknown, fallback: string) {
  const parsedException = parseError(exception)

  useErrorMessage(parsedException.message || fallback, parsedException.why)
}

async function onSubmit() {
  if (!canSubmit.value || isSubmitting.value) {
    return
  }

  const confirmation = await useConfirm({
    text: 'Take this down?',
    subtitle: `${TAKEDOWN_SCOPE_LABELS[scope.value]}. The owner gets the `
      + 'statement of reasons by email.',
    alert: true,
    actions: [TAKEDOWN_ACTION],
    labelDecline: 'Cancel',
  })

  if (confirmation?.label !== TAKEDOWN_ACTION) {
    return
  }

  isSubmitting.value = true

  try {
    result.value = await $fetch('/api/v1/admin/artifact-takedowns', {
      method: 'POST',
      body: {
        target: target.value.trim(),
        scope: scope.value,
        statement: statement.value.trim(),
        legalHold: legalHold.value,
      },
    }) as TakedownResult

    target.value = ''
    statement.value = ''
    legalHold.value = false
    useSuccessMessage('Taken down')
    emit('changed')
  } catch (exception) {
    showError(exception, 'The takedown failed')
  } finally {
    isSubmitting.value = false
  }
}

async function onRestore(restoreTarget: RestoreTarget) {
  const confirmation = await useConfirm({
    text: 'Restore it?',
    subtitle: 'No email is sent. Answer the owner from the privacy mailbox.',
    actions: [RESTORE_ACTION],
    labelDecline: 'Cancel',
  })

  if (confirmation?.label !== RESTORE_ACTION) {
    return
  }

  isRestoring.value = true

  try {
    await $fetch('/api/v1/admin/artifact-takedowns/restore', {
      method: 'POST',
      body: restoreTarget,
    })

    useSuccessMessage('Restored')
    result.value = null
    emit('changed')
  } catch (exception) {
    showError(exception, 'Restore failed')
  } finally {
    isRestoring.value = false
  }
}
</script>
