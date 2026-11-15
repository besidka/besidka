import { describe, expect, it } from 'vitest'
import { deriveConnectorPublisher } from '#shared/utils/connectors-publisher'

describe('deriveConnectorPublisher', () => {
  it.each([
    ['app.linear/linear', 'Linear'],
    ['ai.exa/exa', 'Exa'],
    ['com.notion/mcp', 'Notion'],
    ['com.google.maps/server', 'Google'],
    ['io.github.acme/tool', 'Acme'],
    ['com.github.acme-inc/tool', 'Acme-inc'],
    ['io.gitlab.someone/tool', 'Someone'],
  ])('reads %s as %s', (name, publisher) => {
    expect(deriveConnectorPublisher(name)).toBe(publisher)
  })

  it.each([
    ['no namespace', 'tool'],
    ['one label', 'linear/tool'],
    ['empty', ''],
    ['markup in the namespace', 'io.<b>x</b>/tool'],
    ['an overlong label', `io.${'a'.repeat(41)}/tool`],
  ])('gives nothing for %s', (_label, name) => {
    expect(deriveConnectorPublisher(name)).toBeNull()
  })
})
