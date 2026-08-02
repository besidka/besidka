<template>
  <div class="grid gap-4">
    <div
      v-if="notice"
      role="alert"
      class="alert alert-soft !items-start"
      :class="noticeAlertClass"
    >
      <Icon name="lucide:triangle-alert" size="20" class="mt-0.5 shrink-0" />
      <div class="grid gap-2">
        <p class="font-bold">{{ notice.title }}</p>
        <p class="text-sm">{{ notice.description }}</p>
        <div v-if="notice.action">
          <UiButton
            v-if="notice.action === 'change-email'"
            to="/profile/email"
            text="Change email"
            size="sm"
          />
          <UiButton
            v-else-if="notice.action === 'sign-out'"
            text="Sign out"
            size="sm"
            mode="error"
            :disabled="isProcessing"
            @click="handleSignOut"
          />
        </div>
      </div>
    </div>
    <ul class="grid gap-2">
      <li
        v-for="row in providerRows"
        :key="row.providerId"
        class="flex items-center justify-between gap-4 py-2"
      >
        <div class="flex items-center gap-3">
          <SvgoGoogle v-if="row.providerId === 'google'" class="icon" />
          <SvgoGithub v-else-if="row.providerId === 'github'" class="icon" />
          <Icon v-else name="lucide:mail" size="24" />
          <div>
            <p class="font-medium">{{ row.label }}</p>
            <p class="text-sm text-base-content/70">
              {{ accountStatus(row.providerId) }}
            </p>
          </div>
        </div>
        <UiButton
          v-if="accountFor(row.providerId)"
          text="Disconnect"
          mode="error"
          outline
          size="sm"
          :disabled="isOnlyAccount || isBusy"
          @click="disconnect(row.providerId)"
        />
        <UiButton
          v-else-if="row.providerId !== 'credential'"
          text="Connect"
          size="sm"
          :disabled="isBusy"
          @click="connect(row.providerId)"
        />
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
interface LinkedAccount {
  id: string
  providerId: string
  accountId: string
  userId: string
  createdAt: string | Date
  updatedAt: string | Date
  scopes: string[]
}

interface LinkedAccountsNotice {
  variant: 'error' | 'warning'
  title: string
  description: string
  action?: 'change-email' | 'sign-out'
}

type LinkableProvider = 'google' | 'github'

const providerRows: {
  providerId: 'credential' | LinkableProvider
  label: string
}[] = [
  { providerId: 'credential', label: 'Email & password' },
  { providerId: 'google', label: 'Google' },
  { providerId: 'github', label: 'GitHub' },
]

const providerLabels: Record<string, string> = {
  credential: 'Email & password',
  google: 'Google',
  github: 'GitHub',
}

const $auth = useAuth()
const { errorCodes } = $auth
const route = useRoute()
const router = useRouter()

const initialErrorCode = route.query.error as string | undefined
const initialLinkedProvider = route.query.linked as string | undefined

const accounts = shallowRef<LinkedAccount[]>([])
const isLoading = shallowRef<boolean>(true)
const isProcessing = shallowRef<boolean>(false)
const notice = shallowRef<LinkedAccountsNotice | null>(null)

const isBusy = computed<boolean>(() => isLoading.value || isProcessing.value)
const isOnlyAccount = computed<boolean>(() => accounts.value.length <= 1)

const noticeAlertClass = computed<string>(() => {
  return notice.value?.variant === 'warning' ? 'alert-warning' : 'alert-error'
})

function accountFor(providerId: string): LinkedAccount | undefined {
  return accounts.value.find((account) => {
    return account.providerId === providerId
  })
}

function accountStatus(providerId: string): string {
  const account = accountFor(providerId)

  if (!account) {
    return 'Not connected'
  }

  return `Connected since ${new Date(account.createdAt).toLocaleDateString()}`
}

async function loadAccounts() {
  isLoading.value = true

  const { data, error } = await $auth.client.listAccounts()

  if (!error && data) {
    accounts.value = data
  }

  isLoading.value = false
}

function clearRedirectQuery() {
  const { error: _error, linked: _linked, ...rest } = route.query

  router.replace({ query: rest })
}

function applyRedirectOutcome() {
  if (initialErrorCode === 'email_doesn\'t_match') {
    notice.value = {
      variant: 'error',
      title: 'Emails don\'t match',
      description: 'Linking only works when both accounts share the same '
        + 'verified email address. Change your account email first, then '
        + 'try connecting again.',
      action: 'change-email',
    }
  } else if (initialErrorCode === 'account_already_linked_to_different_user') {
    useErrorMessage(
      'Account already connected',
      'That account is already connected to a different user.',
    )
  } else if (initialErrorCode) {
    useErrorMessage(
      'Could not connect account',
      `Something went wrong (${initialErrorCode}). Please try again.`,
    )
  }

  if (initialLinkedProvider) {
    useSuccessMessage(
      `Connected ${providerLabels[initialLinkedProvider] || initialLinkedProvider}`,
    )
  }

  if (initialErrorCode || initialLinkedProvider) {
    clearRedirectQuery()
  }
}

onMounted(async () => {
  applyRedirectOutcome()
  await loadAccounts()
})

async function connect(provider: LinkableProvider) {
  isProcessing.value = true

  try {
    await $auth.client.linkSocial({
      provider,
      callbackURL: `/profile/security?linked=${provider}`,
      errorCallbackURL: '/profile/security',
    })
  } finally {
    isProcessing.value = false
  }
}

async function disconnect(providerId: 'credential' | LinkableProvider) {
  const account = accountFor(providerId)

  if (!account) {
    return
  }

  const result = await useConfirm({
    text: `Disconnect ${providerLabels[providerId]}?`,
    subtitle: 'You will no longer be able to sign in using this method.',
    actions: ['Disconnect'],
    labelDecline: 'Cancel',
  })

  if (!result) {
    return
  }

  isProcessing.value = true

  try {
    const { error } = await $auth.client.unlinkAccount({
      providerId: account.providerId,
    })

    if (error) {
      if (error.code === errorCodes.FAILED_TO_UNLINK_LAST_ACCOUNT.code) {
        useErrorMessage(
          'This is your only sign-in method',
          'Connect another sign-in method before disconnecting this one.',
        )
      } else if (error.code === errorCodes.SESSION_NOT_FRESH.code) {
        notice.value = {
          variant: 'warning',
          title: 'Recent sign-in required',
          description: 'For your security, this action needs a recent '
            + 'sign-in. Please sign out and sign back in, then try again.',
          action: 'sign-out',
        }
      } else {
        useErrorMessage(error.message || 'Failed to disconnect account')
      }

      return
    }

    useSuccessMessage(`Disconnected ${providerLabels[providerId]}`)
    await loadAccounts()
  } finally {
    isProcessing.value = false
  }
}

async function handleSignOut() {
  await $auth.signOut({
    redirectTo: '/signin',
  })
}
</script>
