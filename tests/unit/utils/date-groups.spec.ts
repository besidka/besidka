import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatActivityAge,
  groupByDate,
} from '../../../shared/utils/date-groups'

describe('date groups', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'))
  })

  it('groups chats using the current date labels', () => {
    const groups = groupByDate([
      { activityAt: '2026-03-11T09:00:00.000Z', id: 'today' },
      { activityAt: '2026-03-10T09:00:00.000Z', id: 'yesterday' },
      { activityAt: '2026-03-08T09:00:00.000Z', id: 'last-week' },
      { activityAt: '2026-02-10T09:00:00.000Z', id: 'last-month' },
    ])

    expect(groups.map(group => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 days',
      'February 2026',
    ])
  })

  it('formats relative activity age', () => {
    expect(formatActivityAge('2026-03-11T11:59:45.000Z')).toBe(
      'Last activity just now',
    )
    expect(formatActivityAge('2026-03-11T11:45:00.000Z')).toBe(
      'Last activity 15 minutes ago',
    )
    expect(formatActivityAge('2026-03-11T09:00:00.000Z')).toBe(
      'Last activity 3 hours ago',
    )
    expect(formatActivityAge('2026-03-09T12:00:00.000Z')).toBe(
      'Last activity 2 days ago',
    )
  })
})
