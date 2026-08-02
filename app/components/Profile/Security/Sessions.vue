<template>
  <div class="grid gap-4">
    <div
      v-if="sessions.length > 1"
      class="flex justify-end"
    >
      <UiButton
        text="Sign out of all other sessions"
        mode="error"
        outline
        size="sm"
        :disabled="isProcessing"
        @click="revokeAllOthers"
      />
    </div>
    <ul class="grid gap-2">
      <li
        v-for="row in sortedSessions"
        :key="row.id"
        class="flex items-center justify-between gap-4 py-2"
      >
        <div>
          <p class="font-medium">
            {{ describeUserAgent(row.userAgent) }}
            <span
              v-if="row.current"
              class="badge badge-sm badge-primary ml-2"
            >
              This device
            </span>
          </p>
          <p class="text-sm text-base-content/70">
            {{ row.ipAddress || 'Unknown IP' }} · Last active
            {{ new Date(row.updatedAt).toLocaleString() }}
          </p>
        </div>
        <UiButton
          v-if="!row.current"
          text="End session"
          mode="error"
          outline
          size="sm"
          :disabled="isProcessing"
          @click="endSession(row)"
        />
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'

interface SessionRow {
  id: number
  current: boolean
  createdAt: string
  updatedAt: string
  expiresAt: string
  ipAddress: string | null
  userAgent: string | null
}

const $auth = useAuth()

const { data, refresh } = await useFetch('/api/v1/profiles/sessions')

const isProcessing = shallowRef<boolean>(false)

const sessions = computed<SessionRow[]>(() => data.value ?? [])

const sortedSessions = computed<SessionRow[]>(() => {
  return [...sessions.value].sort((a, b) => {
    return Number(b.current) - Number(a.current)
  })
})

async function endSession(row: SessionRow) {
  const result = await useConfirm({
    text: 'End this session?',
    subtitle: 'This will end the session — it may take a few minutes to '
      + 'fully log the device out everywhere.',
    actions: ['End session'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    await $fetch(`/api/v1/profiles/sessions/${row.id}/revoke`, {
      method: 'post',
    })
    await refresh()
    useSuccessMessage('Session ended')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to end session',
      parsedException.why,
    )
  } finally {
    isProcessing.value = false
  }
}

async function revokeAllOthers() {
  const result = await useConfirm({
    text: 'Sign out of all other sessions?',
    subtitle: 'This will end every other session — it may take a few '
      + 'minutes to fully log those devices out everywhere.',
    actions: ['Sign out others'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    const { error } = await $auth.client.revokeOtherSessions()

    if (error) {
      useErrorMessage(
        error.message || 'Failed to sign out other sessions',
      )

      return
    }

    await refresh()
    useSuccessMessage('Signed out of all other sessions')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to sign out other sessions',
      parsedException.why,
    )
  } finally {
    isProcessing.value = false
  }
}
</script>
