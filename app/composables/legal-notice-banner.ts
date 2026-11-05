import { formatLegalDate } from '#shared/utils/legal-change-history'
import { getActiveLegalNotices } from '#shared/utils/legal-notices'
import type {
  LegalDocumentId,
  LegalNotice,
} from '#shared/utils/legal-notices'

const LEGACY_DISMISSED_KEY_PREFIX = 'legal-notice:dismissed:'

const DOCUMENT_LABELS: Record<LegalDocumentId, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-of-use': 'Terms of Use',
  'cookie-policy': 'Cookie Policy',
}

export function formatLegalDocumentList(
  documents: readonly LegalDocumentId[],
): string {
  const labels = documents.map((document) => {
    return DOCUMENT_LABELS[document]
  })

  if (labels.length <= 1) {
    return labels.join('')
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

export function getLegalNoticeHref(notice: LegalNotice): string {
  const [firstDocument] = notice.documents

  return `/${firstDocument}#change-history`
}

function getSessionDismissalKey(
  userId: number | string,
  noticeId: string,
): string {
  return `${userId}:${noticeId}`
}

export function removeLegacyLegalNoticeDismissals(): void {
  try {
    const legacyKeys: string[] = []

    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(LEGACY_DISMISSED_KEY_PREFIX)) {
        legacyKeys.push(key)
      }
    }

    for (const key of legacyKeys) {
      window.localStorage.removeItem(key)
    }
  } catch {
    return
  }
}

export function useLegalNoticeVisibility() {
  return useState<boolean>('legal-notice:is-visible', () => false)
}

export function useLegalNoticeBanner() {
  const { loggedIn, user } = useAuth()
  const {
    isSettingsLoaded,
    dismissedLegalNoticeIds,
    dismissLegalNotice,
  } = useUserSetting()
  const dismissedThisSession = useState<string[]>(
    'legal-notice:dismissed-session',
    () => [],
  )
  const now = shallowRef<Date>(new Date())

  const notice = computed<LegalNotice | null>(() => {
    if (
      !loggedIn.value
      || user.value?.id === undefined
      || !isSettingsLoaded.value
    ) {
      return null
    }

    const activeNotice = getActiveLegalNotices(now.value).at(-1) ?? null

    if (!activeNotice) {
      return null
    }

    const isDismissed = dismissedLegalNoticeIds.value.includes(activeNotice.id)
      || dismissedThisSession.value.includes(
        getSessionDismissalKey(user.value.id, activeNotice.id),
      )

    return isDismissed ? null : activeNotice
  })

  const documentsLabel = computed<string>(() => {
    return notice.value ? formatLegalDocumentList(notice.value.documents) : ''
  })

  const effectiveDateLabel = computed<string>(() => {
    return notice.value ? formatLegalDate(notice.value.effectiveAt) : ''
  })

  const href = computed<string>(() => {
    return notice.value ? getLegalNoticeHref(notice.value) : ''
  })

  async function dismiss(): Promise<void> {
    if (!notice.value || user.value?.id === undefined) {
      return
    }

    const noticeId = notice.value.id

    dismissedThisSession.value = [
      ...dismissedThisSession.value,
      getSessionDismissalKey(user.value.id, noticeId),
    ]

    try {
      await dismissLegalNotice(noticeId)
    } catch {
      return
    }
  }

  return {
    notice,
    documentsLabel,
    effectiveDateLabel,
    href,
    dismiss,
  }
}
