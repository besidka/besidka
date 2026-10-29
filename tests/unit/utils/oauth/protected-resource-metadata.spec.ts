import { describe, expect, it } from 'vitest'
import {
  withOriginResource,
} from '~~/server/utils/oauth/protected-resource-metadata'

const metadata = {
  resource: 'https://besidka.com/mcp',
  authorization_servers: ['https://besidka.com'],
  scopes_supported: ['openid', 'chats:read'],
  bearer_methods_supported: ['header'],
}

describe('withOriginResource', () => {
  it('replaces the resource with the origin', () => {
    expect(withOriginResource(metadata, 'https://besidka.com').resource)
      .toBe('https://besidka.com')
  })

  it('keeps every other field untouched', () => {
    const rewritten = withOriginResource(metadata, 'https://besidka.com')

    expect(rewritten).toEqual({
      ...metadata,
      resource: 'https://besidka.com',
    })
  })

  it('adds the resource when the metadata has none', () => {
    expect(withOriginResource({ scopes_supported: [] }, 'https://besidka.com'))
      .toEqual({ scopes_supported: [], resource: 'https://besidka.com' })
  })

  it('does not mutate the input', () => {
    withOriginResource(metadata, 'https://besidka.com')

    expect(metadata.resource).toBe('https://besidka.com/mcp')
  })
})
