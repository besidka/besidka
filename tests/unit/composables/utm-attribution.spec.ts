import { beforeEach, describe, expect, it } from 'vitest'
import { useUtmAttribution } from '../../../app/composables/utm-attribution'

describe('useUtmAttribution', () => {
  beforeEach(() => {
    clearNuxtState('utm-attribution')
  })

  it('starts with empty state', () => {
    const { utm } = useUtmAttribution()

    expect(utm.value).toEqual({})
  })

  it('captures sanitized utm params from the query', () => {
    const { utm, captureUtmFromQuery } = useUtmAttribution()

    captureUtmFromQuery({
      utm_source: 'Newsletter',
      utm_campaign: 'launch-1',
      ref: 'ignored',
    })

    expect(utm.value).toEqual({
      source: 'newsletter',
      campaign: 'launch-1',
    })
  })

  it('accepts URLSearchParams as the query source', () => {
    const { utm, captureUtmFromQuery } = useUtmAttribution()

    captureUtmFromQuery(new URLSearchParams('utm_medium=email'))

    expect(utm.value).toEqual({ medium: 'email' })
  })

  it('ignores a query without valid utm params', () => {
    const { utm, captureUtmFromQuery } = useUtmAttribution()

    captureUtmFromQuery({ utm_source: 'bad value!', page: '2' })

    expect(utm.value).toEqual({})
  })

  it('never overwrites first-touch attribution', () => {
    const { utm, captureUtmFromQuery } = useUtmAttribution()

    captureUtmFromQuery({ utm_source: 'first', utm_campaign: 'one' })
    captureUtmFromQuery({ utm_source: 'second', utm_campaign: 'two' })
    captureUtmFromQuery({ utm_medium: 'email' })

    expect(utm.value).toEqual({ source: 'first', campaign: 'one' })
  })

  it('shares state between composable instances', () => {
    const first = useUtmAttribution()
    const second = useUtmAttribution()

    first.captureUtmFromQuery({ utm_source: 'shared' })

    expect(second.utm.value).toEqual({ source: 'shared' })
  })

  it('leaves paths untouched while no utm is captured', () => {
    const { withUtm, withAuthUtm } = useUtmAttribution()

    expect(withUtm('/signup')).toBe('/signup')
    expect(withAuthUtm('/signup')).toBe('/signup')
  })

  it('appends captured utm params and preserves the existing query', () => {
    const { captureUtmFromQuery, withUtm } = useUtmAttribution()

    captureUtmFromQuery({ utm_source: 'x', utm_campaign: 'test' })

    expect(withUtm('/signup')).toBe('/signup?utm_source=x&utm_campaign=test')
    expect(withUtm('/signin?next=1#top')).toBe(
      '/signin?next=1&utm_source=x&utm_campaign=test#top',
    )
  })

  it('decorates only signup and signin paths with withAuthUtm', () => {
    const { captureUtmFromQuery, withAuthUtm } = useUtmAttribution()

    captureUtmFromQuery({ utm_source: 'x' })

    expect(withAuthUtm('/signup')).toBe('/signup?utm_source=x')
    expect(withAuthUtm('/signin')).toBe('/signin?utm_source=x')
    expect(withAuthUtm('/byok')).toBe('/byok')
    expect(withAuthUtm('/signup-help')).toBe('/signup-help')
    expect(withAuthUtm('#features')).toBe('#features')
    expect(withAuthUtm('https://github.com/besidka/besidka')).toBe(
      'https://github.com/besidka/besidka',
    )
  })

  it('resolves utm from state before the route query', () => {
    const { captureUtmFromQuery, resolveUtm } = useUtmAttribution()

    expect(resolveUtm()).toEqual({})

    captureUtmFromQuery({ utm_source: 'first' })

    expect(resolveUtm()).toEqual({ source: 'first' })
  })
})
