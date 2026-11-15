<template>
  <div class="grid gap-6">
    <div
      v-if="status === 'pending' && !data"
      class="grid gap-2"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="skeleton skeleton--default h-24 w-full"
      />
    </div>
    <div
      v-else-if="error || !data"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="admin-legal-error"
    >
      <span>The legal notices did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="refresh()"
      />
    </div>
    <template v-else>
      <div
        role="status"
        class="alert alert-soft"
        :class="data.sweepEnabled ? 'alert-warning' : 'alert-info'"
        data-testid="admin-legal-sweep-state"
      >
        <Icon
          :name="data.sweepEnabled ? 'lucide:mail-warning' : 'lucide:mail-x'"
          size="20"
          aria-hidden="true"
        />
        <span v-if="data.sweepEnabled">
          Legal notice emails are on. An approved notice is emailed from the
          next sweep, every 5 minutes, while its send window is open.
        </span>
        <span v-else>
          Legal notice emails are off
          (<code>NUXT_LEGAL_NOTICE_SWEEP_ENABLED</code> is not set). Approving
          a notice sends nothing until the switch is turned on as well.
        </span>
      </div>

      <section
        class="bubble rounded-box grid gap-4 p-6"
        data-testid="admin-legal-notices"
      >
        <div class="grid gap-1">
          <h2 class="text-lg font-bold">Notice emails</h2>
          <p class="text-sm text-base-content/70">
            Notices come from code. A notice is emailed only after you approve
            it here, and only while it is unchanged since the approval. The
            in-app banner does not depend on this.
          </p>
        </div>
        <ul class="grid divide-y divide-base-300">
          <li
            v-for="notice in data.notices"
            :key="notice.id"
            class="grid gap-3 py-4"
            :data-testid="`admin-legal-notice-${notice.id}`"
          >
            <div class="flex flex-wrap items-center gap-2">
              <code class="text-sm font-medium break-all">{{ notice.id }}</code>
              <span class="badge badge-soft badge-sm">
                {{ WINDOW_LABELS[notice.windowState] }}
              </span>
              <span
                class="badge badge-soft badge-sm"
                :class="APPROVAL_BADGES[notice.approval.state]"
                :data-testid="`admin-legal-notice-state-${notice.id}`"
              >
                {{ APPROVAL_LABELS[notice.approval.state] }}
              </span>
            </div>
            <p class="text-xs text-base-content/70">
              {{ notice.documents.map(formatDocument).join(', ') }}
            </p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div class="grid">
                <dt class="text-xs text-base-content/70">Published</dt>
                <dd>
                  <UiLocalDate
                    :value="notice.publishedAt"
                    with-time
                  />
                </dd>
              </div>
              <div class="grid">
                <dt class="text-xs text-base-content/70">Send from</dt>
                <dd>
                  <UiLocalDate
                    :value="notice.sendFrom"
                    with-time
                  />
                </dd>
              </div>
              <div class="grid">
                <dt class="text-xs text-base-content/70">Effective</dt>
                <dd>{{ notice.effectiveAt }}</dd>
              </div>
              <div class="grid">
                <dt class="text-xs text-base-content/70">Sent</dt>
                <dd>{{ notice.deliveries.sent }}</dd>
              </div>
              <div class="grid">
                <dt class="text-xs text-base-content/70">Skipped</dt>
                <dd>{{ notice.deliveries.skipped }}</dd>
              </div>
              <div class="grid">
                <dt class="text-xs text-base-content/70">Failed</dt>
                <dd>{{ notice.deliveries.failed }}</dd>
              </div>
            </dl>
            <details class="text-sm">
              <summary class="cursor-pointer text-base-content/70">
                What the email says
              </summary>
              <ul class="mt-2 grid list-disc gap-1 pl-5">
                <li
                  v-for="(line, lineIndex) in notice.summary"
                  :key="lineIndex"
                >
                  {{ line }}
                </li>
              </ul>
            </details>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p
                class="text-sm"
                :data-testid="`admin-legal-notice-recipients-${notice.id}`"
              >
                <span class="font-medium">{{ notice.recipientsNow }}</span>
                {{ notice.recipientsNow === 1 ? 'user' : 'users' }}
                would be emailed now
                <template v-if="notice.approval.approvedAt">
                  · approved
                  <UiLocalDate
                    :value="notice.approval.approvedAt"
                    with-time
                  />
                  <template v-if="notice.approval.approvedByEmail">
                    by {{ notice.approval.approvedByEmail }}
                  </template>
                </template>
              </p>
              <UiButton
                v-if="notice.approval.state === 'none'"
                text="Approve emails"
                size="sm"
                mode="warning"
                outline
                normal-case
                :disabled="isSaving || notice.windowState === 'closed'"
                :data-testid="`admin-legal-notice-approve-${notice.id}`"
                @click="approveNotice(notice)"
              />
              <UiButton
                v-else
                text="Withdraw approval"
                size="sm"
                mode="error"
                outline
                normal-case
                :disabled="isSaving"
                :data-testid="`admin-legal-notice-withdraw-${notice.id}`"
                @click="withdrawNotice(notice)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section
        class="bubble rounded-box grid gap-4 p-6"
        data-testid="admin-legal-consent"
      >
        <div class="grid gap-1">
          <h2 class="text-lg font-bold">Consent version</h2>
          <p class="text-sm text-base-content/70">
            Users are asked for the lower of the version in code and the
            version you approved, so a new version in code asks nobody again
            until you approve it.
          </p>
        </div>
        <dl class="grid grid-cols-3 gap-4 text-sm">
          <div class="grid">
            <dt class="text-xs text-base-content/70">In code</dt>
            <dd>
              <code data-testid="admin-legal-consent-code">
                {{ data.consent.codeVersion }}
              </code>
            </dd>
          </div>
          <div class="grid">
            <dt class="text-xs text-base-content/70">Approved</dt>
            <dd>
              <code data-testid="admin-legal-consent-approved">
                {{ data.consent.approvedVersion }}
              </code>
            </dd>
          </div>
          <div class="grid">
            <dt class="text-xs text-base-content/70">Asked for</dt>
            <dd>
              <code data-testid="admin-legal-consent-effective">
                {{ data.consent.effectiveVersion }}
              </code>
            </dd>
          </div>
        </dl>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm">
            {{ describeAgreedUsers(data.consent) }}
          </p>
          <UiButton
            :text="data.consent.isCodeVersionApproved
              ? 'Code version approved'
              : `Approve ${data.consent.codeVersion}`"
            size="sm"
            mode="warning"
            outline
            normal-case
            :disabled="isSaving || data.consent.isCodeVersionApproved"
            data-testid="admin-legal-consent-approve"
            @click="approveConsentVersion"
          />
        </div>
        <ul
          v-if="data.consent.approvals.length"
          class="grid gap-1 text-xs text-base-content/70"
        >
          <li
            v-for="approval in data.consent.approvals"
            :key="approval.id"
          >
            <code>{{ approval.version }}</code>
            approved
            <UiLocalDate
              :value="approval.approvedAt"
              with-time
            />
            <template v-if="approval.approvedByEmail">
              by {{ approval.approvedByEmail }}
            </template>
          </li>
        </ul>
      </section>

      <section
        class="bubble rounded-box grid gap-4 p-6"
        data-testid="admin-legal-opt-outs"
      >
        <div class="grid gap-1">
          <h2 class="text-lg font-bold">Email opt-outs</h2>
          <p class="text-sm text-base-content/70">
            These accounts never get legal notice emails. They still see the
            notice banner in the app.
          </p>
        </div>
        <AdminUserSearch
          placeholder="Add an account by email or name"
          @select="addOptOut"
        />
        <ul
          class="grid divide-y divide-base-300"
          data-testid="admin-legal-opt-outs-list"
        >
          <li
            v-for="optOut in data.optOuts"
            :key="optOut.userId"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <span class="grid min-w-0">
              <span class="font-medium break-all">
                {{ optOut.email ?? `Deleted account #${optOut.userId}` }}
              </span>
              <span class="text-xs opacity-70">
                #{{ optOut.userId }} · since
                <UiLocalDate :value="optOut.createdAt" />
              </span>
            </span>
            <UiButton
              text="Remove"
              size="sm"
              mode="error"
              outline
              normal-case
              :disabled="isSaving"
              :data-testid="`admin-legal-opt-out-remove-${optOut.userId}`"
              @click="removeOptOut(optOut)"
            />
          </li>
          <li
            v-if="!data.optOuts.length"
            class="py-3 text-sm text-base-content/70"
          >
            No account has opted out.
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import type { AdminSearchUser } from '~/utils/admin-features'

type NoticeWindowState = 'upcoming' | 'open' | 'closed'

type NoticeApprovalState = 'none' | 'approved' | 'changed'

interface AdminLegalNotice {
  id: string
  sendFrom: string
  windowState: NoticeWindowState
  recipientsNow: number
}

interface AdminLegalOptOut {
  userId: number
  email: string | null
}

const WINDOW_LABELS: Record<NoticeWindowState, string> = {
  upcoming: 'Not sending yet',
  open: 'Send window open',
  closed: 'In effect',
}

const APPROVAL_LABELS: Record<NoticeApprovalState, string> = {
  none: 'Not approved',
  approved: 'Approved',
  changed: 'Changed after approval',
}

const APPROVAL_BADGES: Record<NoticeApprovalState, string> = {
  none: '',
  approved: 'badge-warning',
  changed: 'badge-error',
}

const DOCUMENT_LABELS: Record<string, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-of-use': 'Terms of Use',
  'cookie-policy': 'Cookie Policy',
}

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Legal · Admin',
  robots: 'noindex, nofollow',
})

const { data, status, error, refresh } = await useLazyFetch(
  '/api/v1/admin/legal',
)

const isSaving = shallowRef<boolean>(false)

function formatDocument(documentId: string): string {
  return DOCUMENT_LABELS[documentId] ?? documentId
}

function pluralizeUsers(total: number): string {
  return `${total} ${total === 1 ? 'user' : 'users'}`
}

function describeAgreedUsers(consent: {
  usersOnEffectiveVersion: number
  effectiveVersion: string
}): string {
  const total = consent.usersOnEffectiveVersion
  const verb = total === 1 ? 'has' : 'have'

  return `${pluralizeUsers(total)} ${verb} agreed to `
    + `${consent.effectiveVersion}`
}

function describeApproval(notice: AdminLegalNotice): string {
  const recipients = pluralizeUsers(notice.recipientsNow)

  if (!data.value?.sweepEnabled) {
    return `${recipients} would be emailed now. Nothing is sent while `
      + 'NUXT_LEGAL_NOTICE_SWEEP_ENABLED is off; once it is on, they are '
      + 'emailed.'
  }

  if (notice.windowState === 'upcoming') {
    return `${recipients} would be emailed now. Sending starts at `
      + `${new Date(notice.sendFrom).toUTCString()}.`
  }

  return `This emails ${recipients} now, starting with the next sweep `
    + 'within 5 minutes.'
}

async function runAction(
  action: () => Promise<unknown>,
  successMessage: string,
  failureMessage: string,
) {
  isSaving.value = true

  try {
    await action()
    useSuccessMessage(successMessage)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || failureMessage,
      parsedException.why,
    )
  } finally {
    await refresh()
    isSaving.value = false
  }
}

async function approveNotice(notice: AdminLegalNotice) {
  const result = await useConfirm({
    text: `Approve emails for ${notice.id}?`,
    subtitle: describeApproval(notice),
    alert: true,
    actions: [`Approve for ${pluralizeUsers(notice.recipientsNow)}`],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await runAction(
    async () => {
      await $fetch(`/api/v1/admin/legal/notices/${notice.id}/approve`, {
        method: 'POST',
        body: { recipientEstimate: notice.recipientsNow },
      })
    },
    'Notice approved',
    'Failed to approve the notice',
  )
}

async function withdrawNotice(notice: AdminLegalNotice) {
  const result = await useConfirm({
    text: `Stop emails for ${notice.id}?`,
    subtitle: 'No more emails go out from the next sweep. Users who were '
      + 'already emailed are not affected.',
    actions: ['Withdraw'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await runAction(
    async () => {
      await $fetch(`/api/v1/admin/legal/notices/${notice.id}/withdraw`, {
        method: 'POST',
      })
    },
    'Approval withdrawn',
    'Failed to withdraw the approval',
  )
}

async function approveConsentVersion() {
  const consent = data.value?.consent

  if (!consent) {
    return
  }

  const result = await useConfirm({
    text: `Approve consent version ${consent.codeVersion}?`,
    subtitle: 'Every user is asked to agree again on their next visit, '
      + `including the ${pluralizeUsers(consent.usersOnEffectiveVersion)} `
      + `who agreed to ${consent.effectiveVersion}. This cannot be undone `
      + 'here.',
    alert: true,
    actions: ['Approve and ask everyone'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await runAction(
    async () => {
      await $fetch('/api/v1/admin/legal/consent-version/approve', {
        method: 'POST',
        body: { version: consent.codeVersion },
      })
    },
    'Consent version approved',
    'Failed to approve the consent version',
  )
}

async function addOptOut(user: AdminSearchUser) {
  await runAction(
    async () => {
      await $fetch('/api/v1/admin/legal/opt-outs', {
        method: 'POST',
        body: { userId: user.id },
      })
    },
    `${user.email} gets no legal notice emails`,
    'Failed to add the opt-out',
  )
}

async function removeOptOut(optOut: AdminLegalOptOut) {
  const result = await useConfirm({
    text: 'Remove the opt-out?',
    subtitle: `${optOut.email ?? 'This account'} gets legal notice emails `
      + 'again for notices you approve.',
    actions: ['Remove'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  await runAction(
    async () => {
      await $fetch(`/api/v1/admin/legal/opt-outs/${optOut.userId}/remove`, {
        method: 'POST',
      })
    },
    'Opt-out removed',
    'Failed to remove the opt-out',
  )
}
</script>
