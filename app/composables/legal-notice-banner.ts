import { formatLegalDate } from '#shared/utils/legal-change-history'
import { getActiveLegalNotices } from '#shared/utils/legal-notices'
import type {
  LegalDocumentId,
  LegalNotice,
} from '#shared/utils/legal-notices'

const DISMISSED_KEY_PREFIX = 'legal-notice:dismissed:'
const DISMISSED_VALUE = '1'

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

function getDismissedKey(userId: number | string, noticeId: string): string {
  return `${DISMISSED_KEY_PREFIX}${userId}:${noticeId}`
}

function readStoredDismissal(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === DISMISSED_VALUE
  } catch (exception) {
    void exception

    return false
  }
}

function writeStoredDismissal(key: string): void {
  try {
    window.localStorage.setItem(key, DISMISSED_VALUE)
  } catch (exception) {
    void exception
  }
}

export function useLegalNoticeVisibility() {
  return useState<boolean>('legal-notice:is-visible', () => false)
}

export function useLegalNoticeBanner() {
  const { loggedIn, user } = useAuth()
  const dismissedThisSession = useState<string[]>(
    'legal-notice:dismissed-session',
    () => [],
  )
  const now = shallowRef<Date>(new Date())

  const notice = computed<LegalNotice | null>(() => {
    if (!loggedIn.value || user.value?.id === undefined) {
      return null
    }

    const activeNotice = getActiveLegalNotices(now.value).at(-1) ?? null

    if (!activeNotice) {
      return null
    }

    const dismissedKey = getDismissedKey(user.value.id, activeNotice.id)
    const isDismissed = dismissedThisSession.value.includes(dismissedKey)
      || readStoredDismissal(dismissedKey)

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

  function dismiss(): void {
    if (!notice.value || user.value?.id === undefined) {
      return
    }

    const dismissedKey = getDismissedKey(user.value.id, notice.value.id)

    dismissedThisSession.value = [
      ...dismissedThisSession.value,
      dismissedKey,
    ]
    writeStoredDismissal(dismissedKey)
  }

  return {
    notice,
    documentsLabel,
    effectiveDateLabel,
    href,
    dismiss,
  }
}
