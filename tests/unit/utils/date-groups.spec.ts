import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatActivityAge,
  groupByDate,
} from '../../../shared/utils/date-groups'

const defaultTimeZone = process.env.TZ

describe('date groups', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'))
  })

  afterEach(() => {
    process.env.TZ = defaultTimeZone
    vi.useRealTimers()
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

  it('uses UTC day buckets for a stable SSR hydration reference time', () => {
    process.env.TZ = 'Europe/Warsaw'

    const groups = groupByDate(
      [{ activityAt: '2026-03-10T23:30:00.000Z', id: 'late-night' }],
      '2026-03-11T00:15:00.000Z',
    )

    expect(groups.map(group => group.label)).toEqual(['Yesterday'])
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
