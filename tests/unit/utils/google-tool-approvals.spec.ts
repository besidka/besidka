import { describe, expect, it } from 'vitest'
import {
  canOfferGoogleTools,
  googleChatGrantKey,
  googleEgressGrantKey,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'

describe('isGoogleToolName', () => {
  it.each([
    'google__drive_search',
    'Google__Drive_Search',
    'GOOGLE__gmail_create_draft',
  ])('puts %s in the Google family', (toolName) => {
    expect(isGoogleToolName(toolName)).toBe(true)
  })

  it.each([
    ['the bare prefix', 'google__'],
    ['the bare prefix in capitals', 'GOOGLE__'],
    ['a single underscore', 'google_search'],
    ['the provider grounding tool', 'google_search_retrieval'],
    ['a Besidka tool', 'besidka__list_chats'],
    ['a connector tool', 'mcp__google__search'],
    ['an empty name', ''],
    ['a number', 7],
    ['undefined', undefined],
  ])('keeps %s out of the Google family', (_name, toolName) => {
    expect(isGoogleToolName(toolName)).toBe(false)
  })
})

describe('googleChatGrantKey', () => {
  it('keys a Google tool by its exposed name, letter case included', () => {
    expect(googleChatGrantKey('google__drive_search'))
      .toBe('google__drive_search')
    expect(googleChatGrantKey('Google__Drive_Search'))
      .toBe('Google__Drive_Search')
  })

  it('prefixes a name that is not a Google name yet', () => {
    expect(googleChatGrantKey('drive_search')).toBe('google__drive_search')
    expect(googleChatGrantKey('google__')).toBe('google__google__')
  })
})

describe('googleEgressGrantKey', () => {
  it('cannot collide with a connector tool name', () => {
    expect(googleEgressGrantKey('mcp__linear__search'))
      .toBe('google-egress:mcp__linear__search')
  })
})

describe('canOfferGoogleTools', () => {
  it('offers Google tools only while tool approvals are active', () => {
    expect(canOfferGoogleTools({ toolApprovalsActive: true })).toBe(true)
    expect(canOfferGoogleTools({ toolApprovalsActive: false })).toBe(false)
  })
})
