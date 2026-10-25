import { describe, expect, it } from 'vitest'
import { isSafeSameOriginPath } from '#shared/utils/safe-redirect-path'

const ORIGIN = 'https://besidka.com'

describe('isSafeSameOriginPath', () => {
  it.each([
    '/',
    '/chats/new',
    '/_studio',
    '/path?query=1#hash',
    '/a%2Fb',
  ])('accepts %s', (target) => {
    expect(isSafeSameOriginPath(target, ORIGIN)).toBe(true)
  })

  it.each([
    '/foo%20bar',
    '/foo bar',
    '/%20/foo',
    '/ evil',
  ])(
    'accepts %j: a plain space is kept by URL parsing and stays same-origin',
    (target) => {
      expect(isSafeSameOriginPath(target, ORIGIN)).toBe(true)
    },
  )

  it.each([
    '/\\evil.example',
    '/%5Cevil',
    '/%255Cevil',
    '/%2F%2Fevil.example',
    '//evil.example',
    '//',
    'https://evil.example',
    'javascript:alert(1)',
    'evil',
    '',
    '\\\\evil.example',
    '/bad%zz',
    '/%25%25%25%25%25%255Cevil',
  ])('rejects %j', (target) => {
    expect(isSafeSameOriginPath(target, ORIGIN)).toBe(false)
  })

  it.each([
    '/\tevil.example',
    '/%09/evil.example',
    '/%0A/evil.example',
    '/%0D/evil.example',
    '/%2509/evil.example',
    '/%00evil',
    '/%7Fevil',
    '/\u0085evil',
    '/%C2%85evil',
    '/ evil',
    '/ evil',
  ])(
    'rejects %j: tabs, newlines and other control or non-ASCII whitespace '
    + 'are stripped or reinterpreted by browsers',
    (target) => {
      expect(isSafeSameOriginPath(target, ORIGIN)).toBe(false)
    },
  )

  it.each([undefined, null, 1, {}, ['/a']])('rejects non-string %j', (value) => {
    expect(isSafeSameOriginPath(value, ORIGIN)).toBe(false)
  })
})
