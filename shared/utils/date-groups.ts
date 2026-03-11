interface HasActivityAt {
  activityAt: Date | string
}

export interface DateGroup<TChat extends HasActivityAt> {
  label: string
  chats: TChat[]
}

function getGroupLabel(date: Date | string, now: Date): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(today.getDate() - 7)

  const chatDate = new Date(date)
  chatDate.setHours(0, 0, 0, 0)

  if (chatDate.getTime() === today.getTime()) {
    return 'Today'
  }

  if (chatDate.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  }

  if (chatDate.getTime() > sevenDaysAgo.getTime()) {
    return 'Previous 7 days'
  }

  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function groupByDate<TChat extends HasActivityAt>(
  chats: TChat[],
): DateGroup<TChat>[] {
  const now = new Date()
  const groups: Map<string, TChat[]> = new Map()
  const order: string[] = []

  for (const chat of chats) {
    const label = getGroupLabel(chat.activityAt, now)

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
