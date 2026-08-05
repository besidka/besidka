export interface LinkedAccount {
  id: string
  providerId: string
  accountId: string
  userId: string
  createdAt: string | Date
  updatedAt: string | Date
  scopes: string[]
}

export function useLinkedAccounts() {
  const $auth = useAuth()

  const accounts = useState<LinkedAccount[]>('linked-accounts:list', () => [])
  const hasLoaded = useState<boolean>('linked-accounts:has-loaded', () => false)
  const hasAttempted = useState<boolean>(
    'linked-accounts:has-attempted',
    () => false,
  )
  const isFetching = useState<boolean>(
    'linked-accounts:is-fetching',
    () => false,
  )

  // `hasAttempted` (not `isFetching`) drives the skeleton so a forced
  // refetch after a mutation (e.g. disconnecting a provider) — which flips
  // the shared `isFetching` true for every consumer of this cache — does
  // not collapse a card that already has data back to its skeleton. It also
  // stays true after a failed fetch, so a request error can't leave every
  // card stuck showing a skeleton forever.
  const isLoadingInitial = computed<boolean>(() => !hasAttempted.value)

  const hasCredentialAccount = computed<boolean>(() => {
    return accounts.value.some((account) => {
      return account.providerId === 'credential'
    })
  })

  async function fetchLinkedAccounts(options?: { force?: boolean }) {
    if (isFetching.value && !options?.force) {
      return
    }

    if (hasLoaded.value && !options?.force) {
      return
    }

    isFetching.value = true

    try {
      const { data, error } = await $auth.client.listAccounts()

      if (!error && data) {
        accounts.value = data
        hasLoaded.value = true
      }
    } finally {
      isFetching.value = false
      hasAttempted.value = true
    }
  }

  function resetLinkedAccounts() {
    accounts.value = []
    hasLoaded.value = false
    hasAttempted.value = false
    isFetching.value = false
  }

  return {
    accounts,
    isLoading: isFetching,
    isLoadingInitial,
    hasLoaded,
    hasCredentialAccount,
    fetchLinkedAccounts,
    resetLinkedAccounts,
  }
}
