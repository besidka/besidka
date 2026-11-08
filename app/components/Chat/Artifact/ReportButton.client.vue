<template>
  <div class="contents">
    <button
      type="button"
      data-testid="artifact-report-button"
      class="btn btn-ghost btn-sm"
      @click="open"
    >
      <Icon name="lucide:flag" size="14" />
      Report
    </button>
    <Teleport to="body">
      <dialog
        ref="modal"
        data-testid="artifact-report-modal"
        class="modal modal-bottom sm:modal-middle"
        @close="onClosed"
      >
        <form
          class="modal-box max-w-md space-y-3"
          @submit.prevent="submit"
        >
          <h3 class="text-lg font-bold">
            Report artifact
          </h3>
          <p class="text-sm text-base-content/70 break-words">
            {{ title }}
          </p>

          <fieldset class="fieldset">
            <label class="fieldset-legend" :for="`${formId}-reason`">
              Reason
            </label>
            <select
              :id="`${formId}-reason`"
              v-model="reason"
              data-testid="artifact-report-reason"
              class="select select-sm w-full"
              required
            >
              <option
                v-for="option in reasonOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <label class="fieldset-legend" :for="`${formId}-details`">
              What is wrong with it?
            </label>
            <textarea
              :id="`${formId}-details`"
              v-model="details"
              data-testid="artifact-report-details"
              class="textarea textarea-sm w-full"
              rows="4"
              :maxlength="ARTIFACT_REPORT_DETAILS_MAX"
              :placeholder="detailsPlaceholder"
              required
            />
          </fieldset>

          <fieldset class="fieldset">
            <label class="fieldset-legend" :for="`${formId}-name`">
              Your name{{ isContactOptional ? ' (optional)' : '' }}
            </label>
            <input
              :id="`${formId}-name`"
              v-model="reporterName"
              data-testid="artifact-report-name"
              type="text"
              class="input input-sm w-full"
              autocomplete="name"
              :maxlength="ARTIFACT_REPORT_NAME_MAX"
              :required="!isContactOptional"
            >
          </fieldset>

          <fieldset class="fieldset">
            <label class="fieldset-legend" :for="`${formId}-email`">
              Your email{{ isContactOptional ? ' (optional)' : '' }}
            </label>
            <input
              :id="`${formId}-email`"
              v-model="reporterEmail"
              data-testid="artifact-report-email"
              type="email"
              class="input input-sm w-full"
              autocomplete="email"
              :maxlength="ARTIFACT_REPORT_EMAIL_MAX"
              :required="!isContactOptional"
            >
          </fieldset>

          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="isSubmitting"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="artifact-report-submit"
              class="btn btn-primary btn-sm"
              :disabled="isSubmitting"
            >
              <span
                v-if="isSubmitting"
                class="loading loading-spinner loading-xs"
              />
              Send report
            </button>
          </div>
        </form>
        <button
          type="button"
          class="modal-backdrop"
          aria-label="Close"
          @click="close"
        />
      </dialog>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { ArtifactReportReason } from '#shared/utils/artifacts'
import { parseError } from 'evlog'
import {
  ARTIFACT_REPORT_DETAILS_MAX,
  ARTIFACT_REPORT_EMAIL_MAX,
  ARTIFACT_REPORT_NAME_MAX,
} from '#shared/utils/artifacts'

interface Props {
  shareSlug: string
  artifactId: string
  title: string
}

const props = defineProps<Props>()

const reasonOptions: Array<{ value: ArtifactReportReason, label: string }> = [
  { value: 'illegal', label: 'Illegal content' },
  { value: 'harmful', label: 'Harmful or abusive' },
  { value: 'phishing', label: 'Phishing or scam' },
  { value: 'privacy', label: 'Personal data or privacy' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'threat-to-life', label: 'Threat to someone\'s life or safety' },
  { value: 'terrorism', label: 'Terrorist content' },
  { value: 'csam', label: 'Child sexual abuse material' },
  { value: 'other', label: 'Something else' },
]

const formId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const reason = shallowRef<ArtifactReportReason>('illegal')
const details = shallowRef<string>('')
const reporterName = shallowRef<string>('')
const reporterEmail = shallowRef<string>('')
const isSubmitting = shallowRef<boolean>(false)

const isContactOptional = computed<boolean>(() => {
  return reason.value === 'csam'
})

const detailsPlaceholder = computed<string>(() => {
  if (reason.value === 'copyright') {
    return 'Name the work, where the original is, and say that you own '
      + 'the rights or act for the owner.'
  }

  return 'Explain why this artifact should be removed.'
})

function open() {
  modal.value?.showModal()
}

function close() {
  modal.value?.close()
}

function onClosed() {
  if (isSubmitting.value) {
    return
  }

  reason.value = 'illegal'
  details.value = ''
  reporterName.value = ''
  reporterEmail.value = ''
}

async function submit() {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true

  try {
    await $fetch(
      `/api/v1/shared/${encodeURIComponent(props.shareSlug)}/artifacts/`
      + `${encodeURIComponent(props.artifactId)}/report`,
      {
        method: 'POST',
        body: {
          reason: reason.value,
          details: details.value,
          reporterName: reporterName.value || undefined,
          reporterEmail: reporterEmail.value || undefined,
        },
      },
    )

    isSubmitting.value = false
    close()
    useSuccessMessage(
      'Report sent',
      'Thank you. A person will review this artifact.',
    )
  } catch (exception) {
    const parsedException = parseError(exception)

    isSubmitting.value = false
    useErrorMessage(
      parsedException.message || 'Failed to send the report',
      parsedException.why,
    )
  }
}
</script>
