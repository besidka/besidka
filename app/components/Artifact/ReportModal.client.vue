<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="js-artifact-report-modal modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      aria-modal="true"
      data-testid="artifact-report-modal"
      @cancel="onCancel"
      @close="onClosed"
    >
      <div
        class="modal-box flex max-h-[85dvh] w-full max-w-lg flex-col gap-3 [--report-sheet-bottom-padding:max(calc(1rem+var(--sab,0px)),env(safe-area-inset-bottom))] max-sm:pb-[var(--report-sheet-bottom-padding)]"
        :style="sheetBoxStyle"
        data-testid="artifact-report-box"
      >
        <header class="flex shrink-0 items-start gap-3">
          <div class="min-w-0 grow">
            <h2
              :id="headingId"
              class="text-lg font-bold"
            >
              Report artifact
            </h2>
            <p
              class="text-sm break-words text-base-content/70"
              data-testid="artifact-report-title"
            >
              {{ title }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle shrink-0"
            aria-label="Close"
            data-testid="artifact-report-close"
            :disabled="isSubmitting"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
              aria-hidden="true"
            />
          </button>
        </header>

        <div
          v-if="isSubmitted"
          class="flex min-h-0 flex-col gap-3"
          data-testid="artifact-report-success"
        >
          <div
            class="alert alert-success alert-soft items-start"
            role="status"
          >
            <Icon
              name="lucide:circle-check"
              size="18"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p class="font-medium">
                Report sent
              </p>
              <p class="text-sm">
                {{ successText }}
              </p>
            </div>
          </div>
          <div class="modal-action mt-0">
            <button
              ref="doneButton"
              type="button"
              class="btn btn-primary btn-sm min-h-6"
              data-testid="artifact-report-done"
              @click="close"
            >
              Done
            </button>
          </div>
        </div>

        <form
          v-else
          class="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1"
          novalidate
          data-testid="artifact-report-form"
          @submit.prevent="submit"
        >
          <fieldset
            class="fieldset"
            :aria-describedby="describedBy('reason')"
            :aria-invalid="errors.reason ? 'true' : undefined"
          >
            <legend class="fieldset-legend">
              What is wrong with it?
            </legend>
            <div
              class="grid gap-1 sm:grid-cols-2"
              data-testid="artifact-report-reasons"
            >
              <label
                v-for="option in reasonOptions"
                :key="option.value"
                class="label min-h-6 cursor-pointer gap-2 py-1 text-sm whitespace-normal text-base-content"
              >
                <input
                  v-model="reason"
                  type="radio"
                  class="radio radio-sm shrink-0"
                  :name="`${formId}-reason`"
                  :value="option.value"
                  :data-testid="`artifact-report-reason-${option.value}`"
                >
                <span>{{ option.label }}</span>
              </label>
            </div>
            <p
              v-if="errors.reason"
              :id="`${formId}-reason-error`"
              class="text-error text-xs"
              data-testid="artifact-report-reason-error"
            >
              {{ errors.reason }}
            </p>
          </fieldset>

          <p
            v-if="isUrgentReason"
            class="alert alert-warning alert-soft text-sm"
            role="note"
            data-testid="artifact-report-urgent"
          >
            <Icon
              name="lucide:siren"
              size="16"
              class="shrink-0"
              aria-hidden="true"
            />
            <span>
              Urgent reports are read first. If someone is in immediate
              danger, call your local emergency number.
            </span>
          </p>

          <fieldset class="fieldset">
            <label
              class="fieldset-legend"
              :for="`${formId}-details`"
            >
              Details
            </label>
            <textarea
              :id="`${formId}-details`"
              ref="detailsField"
              v-model="details"
              class="textarea w-full"
              rows="4"
              :maxlength="ARTIFACT_REPORT_DETAILS_MAX"
              :placeholder="detailsPlaceholder"
              :aria-invalid="errors.details ? 'true' : undefined"
              :aria-describedby="describedBy('details', 'details-count')"
              data-testid="artifact-report-details"
            />
            <p
              :id="`${formId}-details-count`"
              class="flex justify-between gap-2 text-xs text-base-content/70"
              data-testid="artifact-report-details-count"
            >
              <span>
                {{ ARTIFACT_REPORT_DETAILS_MIN }} to
                {{ ARTIFACT_REPORT_DETAILS_MAX }} characters
              </span>
              <span aria-live="polite">
                {{ detailsLength }} / {{ ARTIFACT_REPORT_DETAILS_MAX }}
              </span>
            </p>
            <p
              v-if="errors.details"
              :id="`${formId}-details-error`"
              class="text-error text-xs"
              data-testid="artifact-report-details-error"
            >
              {{ errors.details }}
            </p>
          </fieldset>

          <fieldset
            v-if="reason === 'copyright'"
            class="fieldset rounded-box border border-base-300 p-3"
            data-testid="artifact-report-copyright"
          >
            <legend class="fieldset-legend px-1">
              Copyright notice
            </legend>
            <p class="text-xs text-base-content/70">
              Besidka adds the link to this artifact for you.
            </p>
            <label
              class="fieldset-legend"
              :for="`${formId}-work`"
            >
              The work you say is copied
            </label>
            <textarea
              :id="`${formId}-work`"
              v-model="copyrightWork"
              class="textarea w-full"
              rows="2"
              :maxlength="ARTIFACT_REPORT_COPYRIGHT_WORK_MAX"
              placeholder="Name the work and where the original is."
              :aria-invalid="errors.work ? 'true' : undefined"
              :aria-describedby="describedBy('work')"
              data-testid="artifact-report-copyright-work"
            />
            <p
              v-if="errors.work"
              :id="`${formId}-work-error`"
              class="text-error text-xs"
            >
              {{ errors.work }}
            </p>
            <label
              class="fieldset-legend"
              :for="`${formId}-owner`"
            >
              Rights owner, if you act for someone else (optional)
            </label>
            <input
              :id="`${formId}-owner`"
              v-model="copyrightOwner"
              type="text"
              class="input w-full"
              :maxlength="ARTIFACT_REPORT_NAME_MAX"
              data-testid="artifact-report-copyright-owner"
            >
            <label class="label min-h-6 cursor-pointer items-start gap-2 py-1 text-sm whitespace-normal text-base-content">
              <input
                v-model="copyrightUnauthorised"
                type="checkbox"
                class="checkbox checkbox-sm mt-0.5 shrink-0"
                :aria-invalid="errors.unauthorisedUse ? 'true' : undefined"
                :aria-describedby="describedBy('unauthorisedUse')"
                data-testid="artifact-report-copyright-unauthorised"
              >
              <span>
                I believe in good faith that this use is not authorised by
                the rights owner, its agent or the law.
              </span>
            </label>
            <p
              v-if="errors.unauthorisedUse"
              :id="`${formId}-unauthorisedUse-error`"
              class="text-error text-xs"
            >
              {{ errors.unauthorisedUse }}
            </p>
            <label class="label min-h-6 cursor-pointer items-start gap-2 py-1 text-sm whitespace-normal text-base-content">
              <input
                v-model="copyrightAuthority"
                type="checkbox"
                class="checkbox checkbox-sm mt-0.5 shrink-0"
                :aria-invalid="errors.authority ? 'true' : undefined"
                :aria-describedby="describedBy('authority')"
                data-testid="artifact-report-copyright-authority"
              >
              <span>
                This notice is accurate, and I own the right or may act for
                its owner.
              </span>
            </label>
            <p
              v-if="errors.authority"
              :id="`${formId}-authority-error`"
              class="text-error text-xs"
            >
              {{ errors.authority }}
            </p>
            <label
              class="fieldset-legend"
              :for="`${formId}-signature`"
            >
              Signature (type your full name)
            </label>
            <input
              :id="`${formId}-signature`"
              v-model="copyrightSignature"
              type="text"
              class="input w-full"
              autocomplete="name"
              :maxlength="ARTIFACT_REPORT_NAME_MAX"
              :aria-invalid="errors.signature ? 'true' : undefined"
              :aria-describedby="describedBy('signature')"
              data-testid="artifact-report-copyright-signature"
            >
            <p
              v-if="errors.signature"
              :id="`${formId}-signature-error`"
              class="text-error text-xs"
            >
              {{ errors.signature }}
            </p>
          </fieldset>

          <fieldset class="fieldset">
            <label
              class="fieldset-legend"
              :for="`${formId}-name`"
            >
              Your name{{ isContactOptional ? ' (optional)' : '' }}
            </label>
            <input
              :id="`${formId}-name`"
              v-model="reporterName"
              type="text"
              class="input w-full"
              autocomplete="name"
              :maxlength="ARTIFACT_REPORT_NAME_MAX"
              :aria-invalid="errors.name ? 'true' : undefined"
              :aria-describedby="describedBy('name')"
              data-testid="artifact-report-name"
            >
            <p
              v-if="errors.name"
              :id="`${formId}-name-error`"
              class="text-error text-xs"
            >
              {{ errors.name }}
            </p>
          </fieldset>

          <fieldset class="fieldset">
            <label
              class="fieldset-legend"
              :for="`${formId}-email`"
            >
              Your email{{ isContactOptional ? ' (optional)' : '' }}
            </label>
            <input
              :id="`${formId}-email`"
              v-model="reporterEmail"
              type="email"
              class="input w-full"
              autocomplete="email"
              inputmode="email"
              :maxlength="ARTIFACT_REPORT_EMAIL_MAX"
              :aria-invalid="errors.email ? 'true' : undefined"
              :aria-describedby="describedBy('email', 'email-hint')"
              data-testid="artifact-report-email"
            >
            <p
              :id="`${formId}-email-hint`"
              class="text-xs text-base-content/70"
            >
              {{ emailHint }}
            </p>
            <p
              v-if="errors.email"
              :id="`${formId}-email-error`"
              class="text-error text-xs"
            >
              {{ errors.email }}
            </p>
          </fieldset>

          <label class="label min-h-6 cursor-pointer items-start gap-2 py-2 text-sm whitespace-normal text-base-content">
            <input
              v-model="goodFaith"
              type="checkbox"
              class="checkbox checkbox-sm mt-0.5 shrink-0"
              :aria-invalid="errors.goodFaith ? 'true' : undefined"
              :aria-describedby="describedBy('goodFaith')"
              data-testid="artifact-report-good-faith"
            >
            <span>
              I confirm that the information in this report is accurate and
              complete to the best of my knowledge, and I send it in good
              faith.
            </span>
          </label>
          <p
            v-if="errors.goodFaith"
            :id="`${formId}-goodFaith-error`"
            class="text-error text-xs"
          >
            {{ errors.goodFaith }}
          </p>

          <AuthTurnstile
            v-if="needsTurnstile"
            ref="turnstile"
            action="report"
          />

          <p class="text-xs text-base-content/70">
            A person reads every report. How reports are handled:
            <NuxtLink
              to="/privacy-policy#reports-and-notices-about-content"
              class="link"
              target="_blank"
            >
              Privacy Policy
            </NuxtLink>.
          </p>

          <div
            v-if="submitError"
            class="alert alert-error alert-soft items-start"
            role="alert"
            data-testid="artifact-report-error"
          >
            <Icon
              name="lucide:circle-alert"
              size="18"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <p class="font-medium">
                {{ submitError.message }}
              </p>
              <p
                v-if="submitError.why"
                class="text-sm"
              >
                {{ submitError.why }}
              </p>
            </div>
          </div>

          <div class="modal-action sticky bottom-0 mt-1 bg-base-100 pt-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm min-h-6"
              :disabled="isSubmitting"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary btn-sm min-h-6"
              :disabled="isSubmitting"
              data-testid="artifact-report-submit"
            >
              <span
                v-if="isSubmitting"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              Send report
            </button>
          </div>
        </form>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button
          type="submit"
          aria-label="Close"
          tabindex="-1"
          :disabled="isSubmitting"
        >
          Close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import type { ArtifactReportReason } from '#shared/utils/artifacts'
import { parseError } from 'evlog'
import {
  ARTIFACT_REPORT_COPYRIGHT_WORK_MAX,
  ARTIFACT_REPORT_DETAILS_MAX,
  ARTIFACT_REPORT_DETAILS_MIN,
  ARTIFACT_REPORT_EMAIL_MAX,
  ARTIFACT_REPORT_NAME_MAX,
  ARTIFACT_REPORT_REASONS,
  ARTIFACT_REPORT_REASON_LABELS,
  ARTIFACT_REPORT_URGENT_REASONS,
} from '#shared/utils/artifacts'
import type TurnstileComponent from '~/components/Auth/Turnstile.client.vue'

type ReportField
  = | 'reason'
    | 'details'
    | 'name'
    | 'email'
    | 'goodFaith'
    | 'work'
    | 'signature'
    | 'unauthorisedUse'
    | 'authority'

interface SubmitError {
  message: string
  why?: string
}

const props = defineProps<{
  title: string
  endpoint: string
  headers?: Record<string, string>
  version?: number | null
}>()

const emit = defineEmits<{
  submitted: []
}>()

const isOpen = defineModel<boolean>('open', { required: true })

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SHEET_KEYBOARD_BOTTOM_PADDING = '0.75rem'
const SHEET_KEYBOARD_TOP_GAP_PX = 12
const FIELD_ORDER: ReportField[] = [
  'reason',
  'details',
  'work',
  'unauthorisedUse',
  'authority',
  'signature',
  'name',
  'email',
  'goodFaith',
]
const FIELD_TEST_IDS: Record<ReportField, string> = {
  reason: 'artifact-report-reason-illegal',
  details: 'artifact-report-details',
  work: 'artifact-report-copyright-work',
  unauthorisedUse: 'artifact-report-copyright-unauthorised',
  authority: 'artifact-report-copyright-authority',
  signature: 'artifact-report-copyright-signature',
  name: 'artifact-report-name',
  email: 'artifact-report-email',
  goodFaith: 'artifact-report-good-faith',
}

const { loggedIn, user } = useAuth()
const { isKeyboardOpen, bottomInset, viewportHeight }
  = useVisualViewportInset()
const turnstileSiteKey = useRuntimeConfig().public.turnstileSiteKey

const formId = useId()
const headingId = useId()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const doneButton = useTemplateRef<HTMLButtonElement>('doneButton')
const turnstile = ref<InstanceType<typeof TurnstileComponent> | null>(null)
const { requestToken } = useCaptcha(() => turnstile.value)

const reason = shallowRef<ArtifactReportReason | null>(null)
const details = shallowRef<string>('')
const reporterName = shallowRef<string>('')
const reporterEmail = shallowRef<string>('')
const goodFaith = shallowRef<boolean>(false)
const copyrightWork = shallowRef<string>('')
const copyrightOwner = shallowRef<string>('')
const copyrightSignature = shallowRef<string>('')
const copyrightUnauthorised = shallowRef<boolean>(false)
const copyrightAuthority = shallowRef<boolean>(false)
const errors = shallowRef<Partial<Record<ReportField, string>>>({})
const submitError = shallowRef<SubmitError | null>(null)
const isSubmitting = shallowRef<boolean>(false)
const isSubmitted = shallowRef<boolean>(false)
const receiptEmail = shallowRef<string>('')

let returnFocusTarget: HTMLElement | null = null

const reasonOptions = ARTIFACT_REPORT_REASONS.map((value) => {
  return { value, label: ARTIFACT_REPORT_REASON_LABELS[value] }
})

const isContactOptional = computed<boolean>(() => {
  return reason.value === 'csam'
})

const isUrgentReason = computed<boolean>(() => {
  return !!reason.value
    && (ARTIFACT_REPORT_URGENT_REASONS as readonly string[])
      .includes(reason.value)
})

const needsTurnstile = computed<boolean>(() => {
  return !loggedIn.value && !!turnstileSiteKey
})

const detailsLength = computed<number>(() => {
  return details.value.trim().length
})

const detailsPlaceholder = computed<string>(() => {
  if (reason.value === 'copyright') {
    return 'Explain how the artifact copies the work.'
  }

  return 'Explain what is wrong with this artifact.'
})

const emailHint = computed<string>(() => {
  if (isContactOptional.value) {
    return 'You can report this without your name or email.'
  }

  return loggedIn.value
    ? 'We send the receipt to your account email and the decision to this '
    + 'address.'
    : 'We send a receipt and the decision to this address.'
})

const successText = computed<string>(() => {
  if (loggedIn.value) {
    return 'Thank you. A person will review it, and a receipt goes to your '
      + 'account email.'
  }

  return receiptEmail.value
    ? `Thank you. A person will review it, and a receipt goes to `
    + `${receiptEmail.value}.`
    : 'Thank you. A person will review it.'
})

const sheetBoxStyle = computed<StyleValue>(() => {
  if (!isOpen.value || !isKeyboardOpen.value) {
    return {}
  }

  return {
    '--report-sheet-bottom-padding': SHEET_KEYBOARD_BOTTOM_PADDING,
    'marginBottom': `${bottomInset.value}px`,
    'maxHeight': `${Math.max(
      0,
      viewportHeight.value - SHEET_KEYBOARD_TOP_GAP_PX,
    )}px`,
  }
})

function describedBy(
  field: ReportField,
  ...extra: string[]
): string | undefined {
  const ids = [
    ...extra.map((suffix) => {
      return `${formId}-${suffix}`
    }),
    ...(errors.value[field] ? [`${formId}-${field}-error`] : []),
  ]

  return ids.length > 0 ? ids.join(' ') : undefined
}

function prefillContact() {
  reporterName.value = user.value?.name ?? ''
  reporterEmail.value = user.value?.email ?? ''
}

function resetForm() {
  reason.value = null
  details.value = ''
  goodFaith.value = false
  copyrightWork.value = ''
  copyrightOwner.value = ''
  copyrightSignature.value = ''
  copyrightUnauthorised.value = false
  copyrightAuthority.value = false
  errors.value = {}
  submitError.value = null
  isSubmitted.value = false
  receiptEmail.value = ''
  prefillContact()
}

function validate(): Partial<Record<ReportField, string>> {
  const found: Partial<Record<ReportField, string>> = {}
  const name = reporterName.value.trim()
  const email = reporterEmail.value.trim()

  if (!reason.value) {
    found.reason = 'Choose a reason.'
  }

  if (detailsLength.value < ARTIFACT_REPORT_DETAILS_MIN) {
    found.details = `Write at least ${ARTIFACT_REPORT_DETAILS_MIN} `
      + 'characters.'
  }

  if (!isContactOptional.value && !name) {
    found.name = 'Enter your name.'
  }

  if (!isContactOptional.value && !email) {
    found.email = 'Enter your email.'
  } else if (email && !EMAIL_PATTERN.test(email)) {
    found.email = 'Enter a valid email address.'
  }

  if (!goodFaith.value) {
    found.goodFaith = 'Confirm that you send this report in good faith.'
  }

  if (reason.value === 'copyright') {
    if (!copyrightWork.value.trim()) {
      found.work = 'Name the work.'
    }

    if (!copyrightSignature.value.trim()) {
      found.signature = 'Type your full name as the signature.'
    }

    if (!copyrightUnauthorised.value) {
      found.unauthorisedUse = 'Confirm this statement.'
    }

    if (!copyrightAuthority.value) {
      found.authority = 'Confirm this statement.'
    }
  }

  return found
}

async function focusFirstError(found: Partial<Record<ReportField, string>>) {
  const field = FIELD_ORDER.find((candidate) => {
    return !!found[candidate]
  })

  if (!field) {
    return
  }

  await nextTick()

  const testId = field === 'reason' && reason.value
    ? `artifact-report-reason-${reason.value}`
    : FIELD_TEST_IDS[field]

  modal.value
    ?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    ?.focus()
}

function buildBody(turnstileToken: string) {
  const name = reporterName.value.trim()
  const email = reporterEmail.value.trim()

  return {
    reason: reason.value,
    details: details.value.trim(),
    ...(name ? { reporterName: name } : {}),
    ...(email ? { reporterEmail: email } : {}),
    goodFaith: true,
    ...(turnstileToken ? { turnstileToken } : {}),
    ...(props.version ? { version: props.version } : {}),
    ...(reason.value === 'copyright'
      ? {
        copyright: {
          work: copyrightWork.value.trim(),
          signature: copyrightSignature.value.trim(),
          ...(copyrightOwner.value.trim()
            ? { ownerName: copyrightOwner.value.trim() }
            : {}),
          unauthorisedUse: true,
          authority: true,
        },
      }
      : {}),
  }
}

async function submit() {
  if (isSubmitting.value) {
    return
  }

  submitError.value = null

  const found = validate()

  errors.value = found

  if (Object.keys(found).length > 0) {
    await focusFirstError(found)

    return
  }

  isSubmitting.value = true

  const turnstileToken = needsTurnstile.value ? await requestToken() : ''

  if (turnstileToken === null) {
    isSubmitting.value = false

    return
  }

  try {
    await $fetch(props.endpoint, {
      method: 'POST',
      headers: props.headers ?? {},
      body: buildBody(turnstileToken),
    })

    receiptEmail.value = reporterEmail.value.trim()
    isSubmitted.value = true
    emit('submitted')
    await nextTick()
    doneButton.value?.focus()
  } catch (exception) {
    const parsedException = parseError(exception)

    turnstile.value?.reset()
    submitError.value = {
      message: parsedException.message || 'Failed to send the report',
      why: parsedException.why,
    }
  } finally {
    isSubmitting.value = false
  }
}

function close() {
  if (isSubmitting.value) {
    return
  }

  isOpen.value = false
}

function onCancel(event: Event) {
  if (isSubmitting.value) {
    event.preventDefault()
  }
}

function onClosed() {
  isOpen.value = false
  resetForm()

  const target = returnFocusTarget

  returnFocusTarget = null

  if (target?.isConnected) {
    target.focus()
  }
}

watch(isOpen, async (open) => {
  await nextTick()

  const dialog = modal.value

  if (!dialog) {
    return
  }

  if (open) {
    if (dialog.open) {
      return
    }

    returnFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    resetForm()
    dialog.showModal()

    return
  }

  if (dialog.open) {
    dialog.close()
  }
}, { immediate: true, flush: 'post' })
</script>
