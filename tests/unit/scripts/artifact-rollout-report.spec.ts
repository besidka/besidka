import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATASET,
  buildExposureQuery,
  parseReportArguments,
  summariseExposures,
} from '../../../scripts/artifact-rollout-report.mjs'

describe('artifact rollout report', () => {
  it('parses defaults and options', () => {
    expect(parseReportArguments([])).toEqual({
      days: 7,
      dataset: DEFAULT_DATASET,
      prefix: 'artifacts',
    })
    expect(parseReportArguments(['--days=30', '--prefix=artifacts.share']))
      .toMatchObject({ days: 30, prefix: 'artifacts.share' })
  })

  it('rejects values that could change the SQL', () => {
    expect(() => parseReportArguments(['--days=0'])).toThrow()
    expect(() => parseReportArguments(['--dataset=a;DROP'])).toThrow()
    expect(() => parseReportArguments(['--prefix=x\' OR 1=1'])).toThrow()
    expect(() => parseReportArguments(['--what=1'])).toThrow()
  })

  it('filters exposure events to the flag family', () => {
    const query = buildExposureQuery({
      dataset: 'besidka_cms_events',
      days: 7,
      prefix: 'artifacts',
    })

    expect(query).toContain('blob1 = \'feature_exposure\'')
    expect(query).toContain(
      '(blob2 = \'artifacts\' OR startsWith(blob2, \'artifacts.\'))',
    )
    expect(query).toContain('INTERVAL \'7\' DAY')
  })

  it('totals exposures per flag, variant and reason', () => {
    expect(summariseExposures([
      { flag: 'artifacts', variant: '', reason: 'ROLLOUT', exposures: '10' },
      { flag: 'artifacts', variant: '', reason: 'ROLLOUT', exposures: '5.4' },
      { flag: 'artifacts.react', variant: 'b', reason: 'ROLLOUT', exposures: 2 },
    ])).toEqual([
      { flag: 'artifacts', variant: '-', reason: 'ROLLOUT', exposures: 15 },
      { flag: 'artifacts.react', variant: 'b', reason: 'ROLLOUT', exposures: 2 },
    ])
  })
})
