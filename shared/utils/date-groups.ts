interface HasActivityAt {
  activityAt: Date | string
}

export interface DateGroup<TChat extends HasActivityAt> {
  label: string
  chats: TChat[]
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function getUtcDayStart(date: Date | string): number {
  const value = new Date(date)

  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  )
}

function getGroupLabel(date: Date | string, now: Date): string {
  const today = getUtcDayStart(now)
  const yesterday = today - DAY_IN_MS
  const sevenDaysAgo = today - (DAY_IN_MS * 7)
  const chatDate = getUtcDayStart(date)

  if (chatDate === today) {
    return 'Today'
  }

  if (chatDate === yesterday) {
    return 'Yesterday'
  }

  if (chatDate > sevenDaysAgo) {
    return 'Previous 7 days'
  }

  return MONTH_FORMATTER.format(new Date(date))
}

export function groupByDate<TChat extends HasActivityAt>(
  chats: TChat[],
  now: Date | string = new Date(),
): DateGroup<TChat>[] {
  const referenceNow = new Date(now)
  const groups: Map<string, TChat[]> = new Map()
  const order: string[] = []

  for (const chat of chats) {
    const label = getGroupLabel(chat.activityAt, referenceNow)

    if (!groups.has(label)) {
      groups.set(label, [])
      order.push(label)
    }

    groups.get(label)!.push(chat)
  }

  return order.map(label => ({
    label,
    chats: groups.get(label)!,
  }))
}

export function formatActivityAge(date: Date | string): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) {
    return 'Last activity just now'
  }

  if (diffMinutes < 60) {
    return `Last activity ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }

  if (diffHours < 24) {
    return `Last activity ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }

  return `Last activity ${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}
